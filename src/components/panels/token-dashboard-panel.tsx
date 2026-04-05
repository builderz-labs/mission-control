'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import {
  UsageStats, TrendData, DashboardView, SessionCostEntry,
  TimezoneOption, PerformanceMetrics, AlertEntry,
  TIMEZONE_OPTIONS,
  buildFallbackSessionCosts, applyFilters, computePerformanceMetrics, buildAlerts,
} from './token-dashboard/token-dashboard-types'
import { TokenFilters } from './token-dashboard/TokenFilters'
import { TokenOverviewCards } from './token-dashboard/TokenOverviewCards'
import { TokenTrendChart, formatTimestampWithTimezone } from './token-dashboard/TokenTrendChart'
import { TokenModelBreakdown } from './token-dashboard/TokenModelBreakdown'
import { TokenSessionsView } from './token-dashboard/TokenSessionsView'

const log = createClientLogger('TokenDashboard')

export function TokenDashboardPanel(): React.JSX.Element {
  const { sessions } = useMissionControl()
  const t = useTranslations('tokenDashboard')

  const [selectedTimeframe, setSelectedTimeframe] = useState<'hour' | 'day' | 'week' | 'month'>('day')
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null)
  const [trendData, setTrendData] = useState<TrendData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<DashboardView>('overview')
  const [sessionCosts, setSessionCosts] = useState<SessionCostEntry[]>([])
  const [sessionSort, setSessionSort] = useState<'cost' | 'tokens' | 'requests' | 'recent'>('cost')
  const [chartMode, setChartMode] = useState<'incremental' | 'cumulative'>('incremental')
  const [modelFilters, setModelFilters] = useState<Set<string>>(new Set())
  const [sessionFilters, setSessionFilters] = useState<Set<string>>(new Set())
  const [selectedTimezone, setSelectedTimezone] = useState<TimezoneOption>(TIMEZONE_OPTIONS[0])

  const loadUsageStats = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/tokens?action=stats&timeframe=${selectedTimeframe}`, { signal: AbortSignal.timeout(8000) })
      const data = await response.json()
      setUsageStats(data)
    } catch (err) {
      log.error('Failed to load usage stats:', err)
      setError('Failed to load usage stats. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [selectedTimeframe])

  const loadTrendData = useCallback(async () => {
    try {
      const response = await fetch(`/api/tokens?action=trends&timeframe=${selectedTimeframe}`, { signal: AbortSignal.timeout(8000) })
      const data = await response.json()
      setTrendData(data)
    } catch (err) {
      log.error('Failed to load trend data:', err)
    }
  }, [selectedTimeframe])

  const loadSessionCosts = useCallback(async () => {
    try {
      const response = await fetch(`/api/tokens?action=session-costs&timeframe=${selectedTimeframe}`, { signal: AbortSignal.timeout(8000) })
      const data = await response.json()
      if (Array.isArray(data?.sessions)) {
        setSessionCosts(data.sessions)
      } else if (usageStats?.sessions) {
        setSessionCosts(buildFallbackSessionCosts(usageStats, sessions))
      }
    } catch {
      if (usageStats?.sessions) {
        setSessionCosts(buildFallbackSessionCosts(usageStats, sessions))
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

  const filteredUsageStats = useMemo((): UsageStats | null => {
    if (!usageStats) return null
    if (modelFilters.size === 0 && sessionFilters.size === 0) return usageStats
    return applyFilters(usageStats, modelFilters, sessionFilters)
  }, [usageStats, modelFilters, sessionFilters])

  const peakTrendHour = useMemo(() => {
    if (!trendData?.trends || trendData.trends.length === 0) return null
    const peak = trendData.trends.reduce((max, t) => t.requests > max.requests ? t : max, trendData.trends[0])
    return formatTimestampWithTimezone(peak.timestamp, selectedTimezone)
  }, [trendData, selectedTimezone])

  const availableModels = useMemo(() => {
    if (!usageStats?.models) return []
    return Object.keys(usageStats.models).sort()
  }, [usageStats])

  const availableSessions = useMemo(() => {
    if (!usageStats?.sessions) return []
    return Object.keys(usageStats.sessions).sort()
  }, [usageStats])

  const cacheStats = useMemo(() => {
    let cacheRead = 0
    let cacheWrite = 0
    for (const entry of sessionCosts) {
      const e = entry as unknown as Record<string, unknown>
      if (typeof e.cacheReadTokens === 'number') cacheRead += e.cacheReadTokens
      if (typeof e.cacheWriteTokens === 'number') cacheWrite += e.cacheWriteTokens
    }
    return cacheRead > 0 || cacheWrite > 0 ? { cacheRead, cacheWrite } : null
  }, [sessionCosts])

  const performanceMetrics = useMemo((): PerformanceMetrics | null => {
    return computePerformanceMetrics(filteredUsageStats)
  }, [filteredUsageStats])

  const alerts = useMemo((): AlertEntry[] => {
    return buildAlerts(filteredUsageStats, performanceMetrics)
  }, [filteredUsageStats, performanceMetrics])

  const sortedSessionCosts = useMemo(() => (
    [...sessionCosts].sort((a, b) => {
      switch (sessionSort) {
        case 'cost': return b.totalCost - a.totalCost
        case 'tokens': return b.totalTokens - a.totalTokens
        case 'requests': return b.requestCount - a.requestCount
        case 'recent': return (b.lastSeen || '').localeCompare(a.lastSeen || '')
        default: return 0
      }
    })
  ), [sessionCosts, sessionSort])

  const hasActiveFilters = modelFilters.size > 0 || sessionFilters.size > 0

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

  const exportClientCsv = useCallback(() => {
    if (!filteredUsageStats) return
    setIsExporting(true)
    try {
      const headers = ['timestamp', 'model', 'session', 'inputTokens', 'outputTokens', 'totalTokens', 'cost']
      const rows: string[] = [headers.join(',')]
      for (const [model, stats] of Object.entries(filteredUsageStats.models)) {
        rows.push([new Date().toISOString(), `"${model}"`, '', '', '', stats.totalTokens, stats.totalCost.toFixed(4)].join(','))
      }
      for (const [sessionId, stats] of Object.entries(filteredUsageStats.sessions)) {
        rows.push([new Date().toISOString(), '', `"${sessionId}"`, '', '', stats.totalTokens, stats.totalCost.toFixed(4)].join(','))
      }
      for (const entry of sessionCosts) {
        rows.push([entry.lastSeen || new Date().toISOString(), `"${entry.model}"`, `"${entry.sessionId}"`, entry.inputTokens, entry.outputTokens, entry.totalTokens, entry.totalCost.toFixed(4)].join(','))
      }
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.download = `usage-${selectedTimeframe}-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      log.error('Client CSV export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }, [filteredUsageStats, sessionCosts, selectedTimeframe])

  const exportData = async (format: 'json' | 'csv') => {
    setIsExporting(true)
    try {
      const response = await fetch(`/api/tokens?action=export&timeframe=${selectedTimeframe}&format=${format}`, { signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error('Export failed')
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
    } catch (err) {
      log.error('Export failed:', err)
      setError('Export failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {error && (
        <div className="mx-4 my-3 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="flex-1">{error}</span>
          <button
            onClick={() => { setError(null); loadUsageStats(); loadTrendData() }}
            className="shrink-0 rounded px-2.5 py-1 text-xs font-medium bg-red-400 text-red-950 hover:bg-red-300"
          >
            Retry
          </button>
        </div>
      )}

      {/* Header + view/timeframe controls */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{t('title')}</h1>
            <p className="text-muted-foreground mt-2">{t('subtitle')}</p>
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
              {(['hour', 'day', 'week', 'month'] as const).map((tf) => (
                <Button
                  key={tf}
                  onClick={() => setSelectedTimeframe(tf)}
                  variant={selectedTimeframe === tf ? 'default' : 'secondary'}
                >
                  {t(`timeframe${tf.charAt(0).toUpperCase() + tf.slice(1)}` as 'timeframeHour' | 'timeframeDay' | 'timeframeWeek' | 'timeframeMonth')}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Filters (overview only) */}
      {view === 'overview' && usageStats && (
        <TokenFilters
          availableModels={availableModels}
          availableSessions={availableSessions}
          sessions={sessions}
          modelFilters={modelFilters}
          sessionFilters={sessionFilters}
          hasActiveFilters={hasActiveFilters}
          selectedTimezone={selectedTimezone}
          onToggleModelFilter={toggleModelFilter}
          onToggleSessionFilter={toggleSessionFilter}
          onClearAllFilters={clearAllFilters}
          onTimezoneChange={setSelectedTimezone}
        />
      )}

      {/* Sessions view */}
      {view === 'sessions' ? (
        <TokenSessionsView
          sortedSessionCosts={sortedSessionCosts}
          sessionSort={sessionSort}
          sessions={sessions}
          onSortChange={setSessionSort}
        />
      ) : isLoading ? (
        <Loader variant="panel" label={t('loadingUsageData')} />
      ) : filteredUsageStats ? (
        <div className="space-y-6">
          <TokenOverviewCards
            usageStats={filteredUsageStats}
            selectedTimeframe={selectedTimeframe}
            cacheStats={cacheStats}
          />
          <div className="grid lg:grid-cols-2 gap-6">
            <TokenTrendChart
              trendData={trendData}
              chartMode={chartMode}
              peakTrendHour={peakTrendHour}
              selectedTimezone={selectedTimezone}
              onChartModeChange={setChartMode}
            />
          </div>
          <TokenModelBreakdown
            filteredUsageStats={filteredUsageStats}
            sessions={sessions}
            performanceMetrics={performanceMetrics}
            alerts={alerts}
            isExporting={isExporting}
            onExportClientCsv={exportClientCsv}
            onExportData={exportData}
          />
        </div>
      ) : (
        <div className="text-center text-muted-foreground py-12">
          <div className="text-lg mb-2">{t('noUsageData')}</div>
          <div className="text-sm">{t('noUsageDataSubtitle')}</div>
          <Button onClick={loadUsageStats} className="mt-4">{t('refresh')}</Button>
        </div>
      )}
    </div>
  )
}

