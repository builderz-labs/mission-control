'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import { detectProvider } from '@/lib/token-utils'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts'

const log = createClientLogger('TokenDashboard')

interface UsageStats {
  summary: {
    totalTokens: number
    totalCost: number
    requestCount: number
    avgTokensPerRequest: number
    avgCostPerRequest: number
  }
  models: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  sessions: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  timeframe: string
  recordCount: number
}

interface TrendData {
  trends: Array<{ timestamp: string; tokens: number; cost: number; requests: number }>
  timeframe: string
}

type DashboardView = 'overview' | 'sessions'

interface SessionCostEntry {
  sessionId: string
  sessionKey?: string
  model: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  totalCost: number
  requestCount: number
  firstSeen: string
  lastSeen: string
}

type TimezoneOption = { label: string; offset: number }

const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { label: 'Local', offset: NaN },
  { label: 'UTC', offset: 0 },
  { label: 'UTC-8 (PST)', offset: -8 },
  { label: 'UTC-7 (MST)', offset: -7 },
  { label: 'UTC-6 (CST)', offset: -6 },
  { label: 'UTC-5 (EST)', offset: -5 },
  { label: 'UTC+1 (CET)', offset: 1 },
  { label: 'UTC+5:30 (IST)', offset: 5.5 },
  { label: 'UTC+8 (CST)', offset: 8 },
  { label: 'UTC+9 (JST)', offset: 9 },
]

const deriveProvider = detectProvider

export function TokenDashboardPanel() {
  const { sessions } = useMissionControl()
  const t = useTranslations('tokenDashboard')

  const [selectedTimeframe, setSelectedTimeframe] = useState<'hour' | 'day' | 'week' | 'month'>('day')
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null)
  const [trendData, setTrendData] = useState<TrendData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [view, setView] = useState<DashboardView>('overview')
  const [sessionCosts, setSessionCosts] = useState<SessionCostEntry[]>([])
  const [sessionSort, setSessionSort] = useState<'cost' | 'tokens' | 'requests' | 'recent'>('cost')
  const [chartMode, setChartMode] = useState<'incremental' | 'cumulative'>('incremental')

  // Filter state
  const [modelFilters, setModelFilters] = useState<Set<string>>(new Set())
  const [sessionFilters, setSessionFilters] = useState<Set<string>>(new Set())

  // Timezone state
  const [selectedTimezone, setSelectedTimezone] = useState<TimezoneOption>(TIMEZONE_OPTIONS[0])

  const loadUsageStats = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/tokens?action=stats&timeframe=${selectedTimeframe}`)
      const data = await response.json()
      setUsageStats(data)
    } catch (error) {
      log.error('Failed to load usage stats:', error)
    } finally {
      setIsLoading(false)
    }
  }, [selectedTimeframe])

  const loadTrendData = useCallback(async () => {
    try {
      const response = await fetch(`/api/tokens?action=trends&timeframe=${selectedTimeframe}`)
      const data = await response.json()
      setTrendData(data)
    } catch (error) {
      log.error('Failed to load trend data:', error)
    }
  }, [selectedTimeframe])

  const loadSessionCosts = useCallback(async () => {
    try {
      const response = await fetch(`/api/tokens?action=session-costs&timeframe=${selectedTimeframe}`)
      const data = await response.json()
      if (Array.isArray(data?.sessions)) {
        setSessionCosts(data.sessions)
      } else if (usageStats?.sessions) {
        const entries: SessionCostEntry[] = Object.entries(usageStats.sessions).map(([sessionId, stats]) => {
          const info = sessions.find(s => s.id === sessionId)
          return {
            sessionId,
            sessionKey: info?.key,
            model: '',
            totalTokens: stats.totalTokens,
            inputTokens: 0,
            outputTokens: 0,
            totalCost: stats.totalCost,
            requestCount: stats.requestCount,
            firstSeen: '',
            lastSeen: '',
          }
        })
        setSessionCosts(entries)
      }
    } catch {
      if (usageStats?.sessions) {
        const entries: SessionCostEntry[] = Object.entries(usageStats.sessions).map(([sessionId, stats]) => {
          const info = sessions.find(s => s.id === sessionId)
          return {
            sessionId,
            sessionKey: info?.key,
            model: '',
            totalTokens: stats.totalTokens,
            inputTokens: 0,
            outputTokens: 0,
            totalCost: stats.totalCost,
            requestCount: stats.requestCount,
            firstSeen: '',
            lastSeen: '',
          }
        })
        setSessionCosts(entries)
      }
    }
  }, [selectedTimeframe, usageStats, sessions])

  useEffect(() => {
    loadUsageStats()
    loadTrendData()
  }, [loadUsageStats, loadTrendData])

  useEffect(() => {
    if (view === 'sessions') loadSessionCosts()
  }, [view, loadSessionCosts])

  // Filtered stats based on active filter chips
  const filteredUsageStats = useMemo((): UsageStats | null => {
    if (!usageStats) return null
    if (modelFilters.size === 0 && sessionFilters.size === 0) return usageStats

    const filteredModels: typeof usageStats.models = {}
    const filteredSessions: typeof usageStats.sessions = {}

    // Filter models
    for (const [model, stats] of Object.entries(usageStats.models)) {
      if (modelFilters.size > 0 && !modelFilters.has(model)) continue
      filteredModels[model] = stats
    }

    // Filter sessions
    for (const [sessionId, stats] of Object.entries(usageStats.sessions)) {
      if (sessionFilters.size > 0 && !sessionFilters.has(sessionId)) continue
      filteredSessions[sessionId] = stats
    }

    // Recalculate summary from filtered models
    const sourceEntries = Object.values(modelFilters.size > 0 ? filteredModels : usageStats.models)
    const totalTokens = sourceEntries.reduce((sum, s) => sum + s.totalTokens, 0)
    const totalCost = sourceEntries.reduce((sum, s) => sum + s.totalCost, 0)
    const requestCount = sourceEntries.reduce((sum, s) => sum + s.requestCount, 0)

    return {
      ...usageStats,
      summary: {
        totalTokens,
        totalCost,
        requestCount,
        avgTokensPerRequest: requestCount > 0 ? Math.round(totalTokens / requestCount) : 0,
        avgCostPerRequest: requestCount > 0 ? totalCost / requestCount : 0,
      },
      models: filteredModels,
      sessions: filteredSessions,
    }
  }, [usageStats, modelFilters, sessionFilters])

  // Client-side CSV export from currently displayed data
  const exportClientCsv = useCallback(() => {
    if (!filteredUsageStats) return
    setIsExporting(true)
    try {
      const headers = ['timestamp', 'model', 'session', 'inputTokens', 'outputTokens', 'totalTokens', 'cost']
      const rows: string[] = [headers.join(',')]

      // Export model-level rows
      for (const [model, stats] of Object.entries(filteredUsageStats.models)) {
        rows.push([
          new Date().toISOString(),
          `"${model}"`,
          '',
          '',
          '',
          stats.totalTokens,
          stats.totalCost.toFixed(4),
        ].join(','))
      }

      // Export session-level rows
      for (const [sessionId, stats] of Object.entries(filteredUsageStats.sessions)) {
        rows.push([
          new Date().toISOString(),
          '',
          `"${sessionId}"`,
          '',
          '',
          stats.totalTokens,
          stats.totalCost.toFixed(4),
        ].join(','))
      }

      // Export session cost detail rows if available
      for (const entry of sessionCosts) {
        rows.push([
          entry.lastSeen || new Date().toISOString(),
          `"${entry.model}"`,
          `"${entry.sessionId}"`,
          entry.inputTokens,
          entry.outputTokens,
          entry.totalTokens,
          entry.totalCost.toFixed(4),
        ].join(','))
      }

      const csv = rows.join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.download = `usage-${selectedTimeframe}-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      log.error('Client CSV export failed:', error)
    } finally {
      setIsExporting(false)
    }
  }, [filteredUsageStats, sessionCosts, selectedTimeframe])

  const exportData = async (format: 'json' | 'csv') => {
    setIsExporting(true)
    try {
      const response = await fetch(`/api/tokens?action=export&timeframe=${selectedTimeframe}&format=${format}`)

      if (!response.ok) {
        throw new Error('Export failed')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.download = `token-usage-${selectedTimeframe}-${new Date().toISOString().split('T')[0]}.${format}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      log.error('Export failed:', error)
      alert('Export failed: ' + error)
    } finally {
      setIsExporting(false)
    }
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M'
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K'
    }
    return num.toString()
  }

  const formatCost = (cost: number) => {
    return '$' + cost.toFixed(4)
  }

  const getModelDisplayName = (modelName: string) => {
    const parts = modelName.split('/')
    return parts[parts.length - 1] || modelName
  }

  const formatTimestamp = useCallback((isoString: string) => {
    const date = new Date(isoString)
    if (isNaN(selectedTimezone.offset)) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    const utcMs = date.getTime() + date.getTimezoneOffset() * 60000
    const adjusted = new Date(utcMs + selectedTimezone.offset * 3600000)
    return adjusted.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }, [selectedTimezone])

  const toggleModelFilter = (model: string) => {
    setModelFilters(prev => {
      const next = new Set(prev)
      if (next.has(model)) next.delete(model)
      else next.add(model)
      return next
    })
  }

  const toggleSessionFilter = (sessionId: string) => {
    setSessionFilters(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  const clearAllFilters = () => {
    setModelFilters(new Set())
    setSessionFilters(new Set())
  }

  const hasActiveFilters = modelFilters.size > 0 || sessionFilters.size > 0

  const prepareModelChartData = () => {
    if (!filteredUsageStats?.models) return []
    return Object.entries(filteredUsageStats.models)
      .map(([model, stats]) => ({
        name: getModelDisplayName(model),
        tokens: stats.totalTokens,
        cost: stats.totalCost,
        requests: stats.requestCount
      }))
      .sort((a, b) => b.cost - a.cost)
  }

  const preparePieChartData = () => {
    if (!filteredUsageStats?.models) return []
    const data = Object.entries(filteredUsageStats.models)
      .map(([model, stats]) => ({
        name: getModelDisplayName(model),
        value: stats.totalCost,
        tokens: stats.totalTokens
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)

    return data
  }

  const prepareProviderPieData = () => {
    if (!filteredUsageStats?.models) return []
    const providerMap: Record<string, { cost: number; tokens: number }> = {}
    for (const [model, stats] of Object.entries(filteredUsageStats.models)) {
      const provider = deriveProvider(model)
      if (!providerMap[provider]) providerMap[provider] = { cost: 0, tokens: 0 }
      providerMap[provider].cost += stats.totalCost
      providerMap[provider].tokens += stats.totalTokens
    }
    return Object.entries(providerMap)
      .map(([name, data]) => ({ name, value: data.cost, tokens: data.tokens }))
      .sort((a, b) => b.value - a.value)
  }

  const prepareTrendChartData = () => {
    if (!trendData?.trends) return []
    const raw = trendData.trends.map(trend => ({
      time: formatTimestamp(trend.timestamp),
      tokens: trend.tokens,
      cost: trend.cost,
      requests: trend.requests
    }))

    if (chartMode === 'cumulative') {
      let cumTokens = 0
      let cumCost = 0
      let cumRequests = 0
      return raw.map(d => {
        cumTokens += d.tokens
        cumCost += d.cost
        cumRequests += d.requests
        return { ...d, tokens: cumTokens, cost: cumCost, requests: cumRequests }
      })
    }

    return raw
  }

  // Find peak error/request hour for trend highlighting
  const peakTrendHour = useMemo(() => {
    if (!trendData?.trends || trendData.trends.length === 0) return null
    let peak = trendData.trends[0]
    for (const t of trendData.trends) {
      if (t.requests > peak.requests) peak = t
    }
    return formatTimestamp(peak.timestamp)
  }, [trendData, formatTimestamp])

  const sortedSessionCosts = [...sessionCosts].sort((a, b) => {
    switch (sessionSort) {
      case 'cost': return b.totalCost - a.totalCost
      case 'tokens': return b.totalTokens - a.totalTokens
      case 'requests': return b.requestCount - a.requestCount
      case 'recent': return (b.lastSeen || '').localeCompare(a.lastSeen || '')
      default: return 0
    }
  })

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d']
  const PROVIDER_COLORS: Record<string, string> = {
    Anthropic: '#d97706',
    OpenAI: '#10b981',
    Google: '#3b82f6',
    Mistral: '#f97316',
    Meta: '#6366f1',
    DeepSeek: '#06b6d4',
    Cohere: '#ec4899',
    Other: '#6b7280',
  }

  // Enhanced performance metrics
  const getPerformanceMetrics = () => {
    if (!filteredUsageStats?.models) return null

    const models = Object.entries(filteredUsageStats.models)
    if (models.length === 0) return null

    let mostEfficient = { model: models[0][0], stats: models[0][1] }
    for (const [model, stats] of models) {
      const costPerToken = stats.totalCost / Math.max(1, stats.totalTokens)
      const bestCostPerToken = mostEfficient.stats.totalCost / Math.max(1, mostEfficient.stats.totalTokens)
      if (costPerToken < bestCostPerToken) {
        mostEfficient = { model, stats }
      }
    }

    let mostUsed = { model: models[0][0], stats: models[0][1] }
    for (const [model, stats] of models) {
      if (stats.requestCount > mostUsed.stats.requestCount) {
        mostUsed = { model, stats }
      }
    }

    let mostExpensive = { model: models[0][0], stats: models[0][1] }
    for (const [model, stats] of models) {
      const costPerToken = stats.totalCost / Math.max(1, stats.totalTokens)
      const bestCostPerToken = mostExpensive.stats.totalCost / Math.max(1, mostExpensive.stats.totalTokens)
      if (costPerToken > bestCostPerToken) {
        mostExpensive = { model, stats }
      }
    }

    const totalTokens = filteredUsageStats.summary.totalTokens
    const currentCost = filteredUsageStats.summary.totalCost
    const efficientCostPerToken = mostEfficient.stats.totalCost / Math.max(1, mostEfficient.stats.totalTokens)
    const potentialCost = totalTokens * efficientCostPerToken
    const potentialSavings = Math.max(0, currentCost - potentialCost)

    return {
      mostEfficient,
      mostUsed,
      mostExpensive,
      potentialSavings,
      savingsPercentage: currentCost > 0 ? (potentialSavings / currentCost) * 100 : 0
    }
  }

  const performanceMetrics = getPerformanceMetrics()

  const getAlerts = () => {
    const alerts = []

    if (filteredUsageStats && filteredUsageStats.summary.totalCost !== undefined && filteredUsageStats.summary.totalCost > 100) {
      alerts.push({
        type: 'warning',
        title: 'High Usage Cost',
        message: `Total cost of ${formatCost(filteredUsageStats.summary.totalCost)} exceeds $100 threshold`,
        suggestion: 'Consider using more cost-effective models for routine tasks'
      })
    }

    if (performanceMetrics && performanceMetrics.savingsPercentage !== undefined && performanceMetrics.savingsPercentage > 20) {
      alerts.push({
        type: 'info',
        title: 'Optimization Opportunity',
        message: `Using ${getModelDisplayName(performanceMetrics.mostEfficient.model)} could save ${formatCost(performanceMetrics.potentialSavings)} (${performanceMetrics.savingsPercentage.toFixed(1)}%)`,
        suggestion: 'Consider switching routine tasks to more efficient models'
      })
    }

    if (filteredUsageStats && filteredUsageStats.summary.requestCount !== undefined && filteredUsageStats.summary.requestCount > 1000) {
      alerts.push({
        type: 'info',
        title: 'High Request Volume',
        message: `${filteredUsageStats.summary.requestCount} requests in selected timeframe`,
        suggestion: 'Consider implementing request batching or caching for efficiency'
      })
    }

    return alerts
  }

  const alerts = getAlerts()

  // Available models and sessions for filter chips
  const availableModels = useMemo(() => {
    if (!usageStats?.models) return []
    return Object.keys(usageStats.models).sort()
  }, [usageStats])

  const availableSessions = useMemo(() => {
    if (!usageStats?.sessions) return []
    return Object.keys(usageStats.sessions).sort()
  }, [usageStats])

  // Cache token stats from session costs (if available in the data)
  const cacheStats = useMemo(() => {
    // Aggregate from session cost entries if they have cache token info
    // For now show zeroes; real data flows once backend provides cacheReadTokens/cacheWriteTokens
    let cacheRead = 0
    let cacheWrite = 0
    for (const entry of sessionCosts) {
      const e = entry as unknown as Record<string, unknown>
      if (typeof e.cacheReadTokens === 'number') cacheRead += e.cacheReadTokens
      if (typeof e.cacheWriteTokens === 'number') cacheWrite += e.cacheWriteTokens
    }
    return cacheRead > 0 || cacheWrite > 0 ? { cacheRead, cacheWrite } : null
  }, [sessionCosts])

  return (
    <div className="p-6 space-y-6">
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
            <p className="text-muted-foreground mt-2">
              {t('subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setView('overview')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'overview' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
              >
                {t('viewOverview')}
              </button>
              <button
                onClick={() => setView('sessions')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'sessions' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
              >
                {t('viewSessions')}
              </button>
            </div>
            <div className="flex space-x-2">
              {(['hour', 'day', 'week', 'month'] as const).map((timeframe) => (
                <Button
                  key={timeframe}
                  onClick={() => setSelectedTimeframe(timeframe)}
                  variant={selectedTimeframe === timeframe ? 'default' : 'secondary'}
                >
                  {t(`timeframe${timeframe.charAt(0).toUpperCase() + timeframe.slice(1)}` as 'timeframeHour' | 'timeframeDay' | 'timeframeWeek' | 'timeframeMonth')}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Filter Chips Bar */}
      {view === 'overview' && usageStats && (availableModels.length > 0 || availableSessions.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">{t('filtersLabel')}</span>
          {availableModels.map(model => (
            <button
              key={`model-${model}`}
              onClick={() => toggleModelFilter(model)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                modelFilters.has(model)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/30'
              }`}
            >
              {getModelDisplayName(model)}
              {modelFilters.has(model) && <span className="ml-0.5">x</span>}
            </button>
          ))}
          {availableSessions.length > 0 && availableModels.length > 0 && (
            <span className="text-border">|</span>
          )}
          {availableSessions.slice(0, 8).map(sessionId => {
            const info = sessions.find(s => s.id === sessionId)
            const label = info?.key || sessionId.split(':')[0] || sessionId
            return (
              <button
                key={`session-${sessionId}`}
                onClick={() => toggleSessionFilter(sessionId)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  sessionFilters.has(sessionId)
                    ? 'bg-blue-500/30 text-blue-300 border-blue-500/50'
                    : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/30'
                }`}
              >
                {label}
                {sessionFilters.has(sessionId) && <span className="ml-0.5">x</span>}
              </button>
            )
          })}
          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
            >
              {t('clearAll')}
            </button>
          )}
        </div>
      )}

      {/* Timezone Selector */}
      {view === 'overview' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('timezoneLabel')}</span>
          <select
            value={selectedTimezone.label}
            onChange={(e) => {
              const tz = TIMEZONE_OPTIONS.find(t => t.label === e.target.value)
              if (tz) setSelectedTimezone(tz)
            }}
            className="bg-card border border-border rounded px-2 py-1 text-xs text-foreground"
          >
            {TIMEZONE_OPTIONS.map(tz => (
              <option key={tz.label} value={tz.label}>{tz.label}</option>
            ))}
          </select>
        </div>
      )}

      {view === 'sessions' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{t('sortByLabel')}</span>
            {(['cost', 'tokens', 'requests', 'recent'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSessionSort(s)}
                className={`px-2 py-1 text-xs rounded ${sessionSort === s ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {sortedSessionCosts.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <p className="text-lg mb-1">{t('noSessionCostData')}</p>
              <p className="text-sm">{t('noSessionCostSubtitle')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedSessionCosts.map((entry) => {
                const sessionInfo = sessions.find(s => s.id === entry.sessionId)
                return (
                  <div key={entry.sessionId} className="bg-card border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">
                          {entry.sessionKey || sessionInfo?.key || entry.sessionId}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          {sessionInfo?.active && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />}
                          <span>{sessionInfo?.active ? t('sessionActive') : t('sessionInactive')}</span>
                          {entry.model && <span>| {getModelDisplayName(entry.model)}</span>}
                          {sessionInfo?.kind && <span>| {sessionInfo.kind}</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-lg font-bold text-foreground">{formatCost(entry.totalCost)}</div>
                        <div className="text-xs text-muted-foreground">{formatNumber(entry.totalTokens)} tokens</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-xs text-muted-foreground border-t border-border/50 pt-2 mt-2">
                      <div><span className="font-medium text-foreground">{entry.requestCount}</span> {t('requests')}</div>
                      <div><span className="font-medium text-foreground">{formatNumber(entry.inputTokens || 0)}</span> {t('inSuffix')}</div>
                      <div><span className="font-medium text-foreground">{formatNumber(entry.outputTokens || 0)}</span> {t('outSuffix')}</div>
                      <div>
                        {entry.totalTokens > 0
                          ? <span className="font-medium text-foreground">{formatCost(entry.totalCost / entry.requestCount)}</span>
                          : '-'
                        }{' '}{t('avgPerRequest')}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : isLoading ? (
        <Loader variant="panel" label={t('loadingUsageData')} />
      ) : filteredUsageStats ? (
        <div className="space-y-6">
          {/* Overview Stats */}
          <div className={`grid grid-cols-1 gap-6 ${cacheStats ? 'md:grid-cols-6' : 'md:grid-cols-4'}`}>
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(filteredUsageStats.summary.totalTokens)}
              </div>
              <div className="text-sm text-muted-foreground">
                {t('totalTokens', { timeframe: selectedTimeframe })}
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-3xl font-bold text-foreground">
                {formatCost(filteredUsageStats.summary.totalCost)}
              </div>
              <div className="text-sm text-muted-foreground">
                {t('totalCost', { timeframe: selectedTimeframe })}
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(filteredUsageStats.summary.requestCount)}
              </div>
              <div className="text-sm text-muted-foreground">
                {t('apiRequests')}
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-3xl font-bold text-foreground">
                {formatNumber(filteredUsageStats.summary.avgTokensPerRequest)}
              </div>
              <div className="text-sm text-muted-foreground">
                {t('avgTokensPerRequest')}
              </div>
            </div>

            {cacheStats && (
              <>
                <div className="bg-card border border-border rounded-lg p-6">
                  <div className="text-3xl font-bold text-cyan-400">
                    {formatNumber(cacheStats.cacheRead)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {t('cacheReadTokens')}
                  </div>
                </div>

                <div className="bg-card border border-border rounded-lg p-6">
                  <div className="text-3xl font-bold text-amber-400">
                    {formatNumber(cacheStats.cacheWrite)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {t('cacheWriteTokens')}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Charts Section */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Usage Trends Chart */}
            <div className="bg-card border border-border rounded-lg p-6 lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">{t('usageTrends', { timeframe: selectedTimeframe })}</h2>
                <div className="flex items-center gap-3">
                  {peakTrendHour && (
                    <span className="text-xs text-muted-foreground">
                      {t('peakLabel')} <span className="text-foreground font-medium">{peakTrendHour}</span>
                    </span>
                  )}
                  <div className="flex rounded-md border border-border overflow-hidden">
                    <button
                      onClick={() => setChartMode('incremental')}
                      className={`px-2 py-1 text-[10px] font-medium ${chartMode === 'incremental' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
                    >
                      {t('perTurnButton')}
                    </button>
                    <button
                      onClick={() => setChartMode('cumulative')}
                      className={`px-2 py-1 text-[10px] font-medium ${chartMode === 'cumulative' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
                    >
                      {t('cumulativeButton')}
                    </button>
                  </div>
                </div>
              </div>
              <div className="h-64">
                {prepareTrendChartData().length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noTrendData')}</div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={prepareTrendChartData()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="tokens"
                      stroke="#8884d8"
                      strokeWidth={2}
                      name={t('chartTokens')}
                    />
                    <Line
                      type="monotone"
                      dataKey="requests"
                      stroke="#82ca9d"
                      strokeWidth={2}
                      name={t('chartRequests')}
                    />
                  </LineChart>
                </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Model Usage Bar Chart */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('tokenUsageByModel')}</h2>
              <div className="h-64">
                {prepareModelChartData().length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noModelUsageData')}</div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={prepareModelChartData()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="name"
                      angle={-45}
                      textAnchor="end"
                      height={80}
                      interval={0}
                    />
                    <YAxis />
                    <Tooltip formatter={(value, name) => [formatNumber(Number(value)), name]} />
                    <Bar dataKey="tokens" fill="#8884d8" name={t('chartTokens')} />
                  </BarChart>
                </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Cost Distribution Pie Chart */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('costDistributionByModel')}</h2>
              <div className="h-64">
                {preparePieChartData().length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noCostData')}</div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={preparePieChartData()}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {preparePieChartData().map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCost(Number(value))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Cost by Provider Pie Chart */}
            <div className="bg-card border border-border rounded-lg p-6 lg:col-span-2">
              <h2 className="text-xl font-semibold mb-4">{t('costByProvider')}</h2>
              <div className="h-64">
                {prepareProviderPieData().length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">{t('noProviderData')}</div>
                ) : (
                <div className="flex h-full">
                  <div className="flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={prepareProviderPieData()}
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {prepareProviderPieData().map((entry) => (
                            <Cell key={entry.name} fill={PROVIDER_COLORS[entry.name] || PROVIDER_COLORS.Other} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => formatCost(Number(value))} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-48 flex flex-col justify-center space-y-2">
                    {prepareProviderPieData().map(entry => (
                      <div key={entry.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: PROVIDER_COLORS[entry.name] || PROVIDER_COLORS.Other }}
                          />
                          <span className="text-muted-foreground">{entry.name}</span>
                        </div>
                        <span className="text-foreground font-medium">{formatCost(entry.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                )}
              </div>
            </div>
          </div>

          {/* Export Section */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">{t('exportData')}</h2>
              <div className="flex space-x-2">
                <Button
                  onClick={exportClientCsv}
                  disabled={isExporting}
                  className="bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30"
                >
                  {isExporting ? t('exporting') : t('exportCsvFiltered')}
                </Button>
                <Button
                  onClick={() => exportData('csv')}
                  disabled={isExporting}
                  className="bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
                >
                  {isExporting ? t('exporting') : t('exportCsvFull')}
                </Button>
                <Button
                  onClick={() => exportData('json')}
                  disabled={isExporting}
                  variant="success"
                >
                  {isExporting ? t('exporting') : t('exportJson')}
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Export token usage data for analysis. &quot;Filtered&quot; exports only the currently displayed data; &quot;Full&quot; exports all records from the server.
            </p>
          </div>

          {/* Performance Insights */}
          {performanceMetrics && (
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('performanceInsights')}</h2>

              {/* Alerts */}
              {alerts.length > 0 && (
                <div className="mb-6 space-y-3">
                  {alerts.map((alert, index) => (
                    <div
                      key={index}
                      className={`border-l-4 p-4 rounded ${
                        alert.type === 'warning'
                          ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
                          : 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      }`}
                    >
                      <div className="flex items-start">
                        <div className="flex-shrink-0">
                          {alert.type === 'warning' ? '!!' : 'i'}
                        </div>
                        <div className="ml-3">
                          <p className="text-sm font-medium">{alert.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">{alert.message}</p>
                          <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">{alert.suggestion}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Performance Metrics Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="bg-secondary rounded-lg p-4">
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('mostEfficientModel')}</h3>
                  <div className="text-lg font-bold text-green-600 dark:text-green-400">
                    {getModelDisplayName(performanceMetrics.mostEfficient.model)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ${(performanceMetrics.mostEfficient.stats.totalCost / Math.max(1, performanceMetrics.mostEfficient.stats.totalTokens) * 1000).toFixed(4)}/1K tokens
                  </div>
                </div>

                <div className="bg-secondary rounded-lg p-4">
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('mostUsedModel')}</h3>
                  <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                    {getModelDisplayName(performanceMetrics.mostUsed.model)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {performanceMetrics.mostUsed.stats.requestCount} requests
                  </div>
                </div>

                <div className="bg-secondary rounded-lg p-4">
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">{t('optimizationPotential')}</h3>
                  <div className="text-lg font-bold text-orange-600 dark:text-orange-400">
                    {formatCost(performanceMetrics.potentialSavings)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('savingsPossible', { pct: performanceMetrics.savingsPercentage.toFixed(1) })}
                  </div>
                </div>
              </div>

              {/* Model Efficiency Comparison */}
              <div className="mt-4">
                <h3 className="text-sm font-medium mb-3">{t('modelEfficiencyComparison')}</h3>
                <div className="space-y-2">
                  {Object.entries(filteredUsageStats?.models || {})
                    .map(([model, stats]) => {
                      const costPerToken = stats.totalCost / Math.max(1, stats.totalTokens) * 1000
                      const efficiency = 1 / costPerToken
                      const maxEfficiency = Math.max(...Object.values(filteredUsageStats?.models || {}).map(s => 1 / (s.totalCost / Math.max(1, s.totalTokens) * 1000)))
                      const barWidth = (efficiency / maxEfficiency) * 100

                      return (
                        <div key={model} className="flex items-center text-sm">
                          <div className="w-32 truncate text-muted-foreground">
                            {getModelDisplayName(model)}
                          </div>
                          <div className="flex-1 mx-3">
                            <div className="w-full bg-secondary rounded-full h-2">
                              <div
                                className="bg-green-500 h-2 rounded-full"
                                style={{ width: `${barWidth}%` }}
                              ></div>
                            </div>
                          </div>
                          <div className="w-20 text-right text-xs text-muted-foreground">
                            ${costPerToken.toFixed(4)}/1K
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
            </div>
          )}

          {/* Detailed Statistics */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Model Statistics */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('modelPerformance')}</h2>

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {Object.entries(filteredUsageStats.models)
                  .sort(([,a], [,b]) => b.totalCost - a.totalCost)
                  .map(([model, stats]) => {
                    const avgCostPerRequest = stats.totalCost / Math.max(1, stats.requestCount)
                    const avgTokensPerRequest = stats.totalTokens / Math.max(1, stats.requestCount)

                    return (
                      <div key={model} className="p-3 bg-secondary rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium text-foreground">
                            {getModelDisplayName(model)}
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-foreground">
                              {formatCost(stats.totalCost)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatNumber(stats.totalTokens)} tokens
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
                          <div>
                            <div className="font-medium">{stats.requestCount}</div>
                            <div>{t('requestsLabel')}</div>
                          </div>
                          <div>
                            <div className="font-medium">{formatCost(avgCostPerRequest)}</div>
                            <div>{t('avgCost')}</div>
                          </div>
                          <div>
                            <div className="font-medium">{formatNumber(avgTokensPerRequest)}</div>
                            <div>{t('avgTokens')}</div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>

            {/* Session Statistics */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">{t('topSessionsByCost')}</h2>

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {Object.entries(filteredUsageStats.sessions)
                  .sort(([,a], [,b]) => b.totalCost - a.totalCost)
                  .slice(0, 10)
                  .map(([sessionId, stats]) => {
                    const sessionInfo = sessions.find(s => s.id === sessionId)
                    const avgCostPerRequest = stats.totalCost / Math.max(1, stats.requestCount)

                    return (
                      <div key={sessionId} className="p-3 bg-secondary rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <div className="font-medium text-foreground">
                              {sessionInfo?.key || sessionId}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {sessionInfo?.active ? t('sessionActive') : t('sessionInactive')}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-foreground">
                              {formatCost(stats.totalCost)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatNumber(stats.totalTokens)} tokens
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                          <div>
                            <div className="font-medium">{stats.requestCount}</div>
                            <div>{t('requestsLabel')}</div>
                          </div>
                          <div>
                            <div className="font-medium">{formatCost(avgCostPerRequest)}</div>
                            <div>{t('avgCost')}</div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center text-muted-foreground py-12">
          <div className="text-lg mb-2">{t('noUsageData')}</div>
          <div className="text-sm">{t('noUsageDataSubtitle')}</div>
          <Button
            onClick={loadUsageStats}
            className="mt-4"
          >
            {t('refresh')}
          </Button>
        </div>
      )}
    </div>
  )
}
