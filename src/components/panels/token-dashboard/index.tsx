'use client'

import type { JSX } from 'react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import { downloadText, downloadBlob } from '@/lib/download'
import { TIMEZONE_OPTIONS } from './constants'
import { getPeakTrendHour, getPerformanceMetrics, getAlerts } from './chart-helpers'
import { StatsCards } from './stats-cards'
import { ChartsSection } from './charts-section'
import { SessionsView } from './sessions-view'
import { InsightsSection } from './insights-section'
import type {
  UsageStats, TrendData, DashboardView, SessionCostEntry, TimezoneOption,
} from './types'

const log = createClientLogger('TokenDashboard')

export function TokenDashboardPanel(): JSX.Element {
  const { sessions } = useMissionControl()

  const [selectedTimeframe, setSelectedTimeframe] = useState<'hour' | 'day' | 'week' | 'month'>('day')
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null)
  const [trendData, setTrendData] = useState<TrendData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [view, setView] = useState<DashboardView>('overview')
  const [sessionCosts, setSessionCosts] = useState<SessionCostEntry[]>([])
  const [sessionSort, setSessionSort] = useState<'cost' | 'tokens' | 'requests' | 'recent'>('cost')
  const [chartMode, setChartMode] = useState<'incremental' | 'cumulative'>('incremental')
  const [modelFilters, setModelFilters] = useState<Set<string>>(new Set())
  const [sessionFilters, setSessionFilters] = useState<Set<string>>(new Set())
  const [selectedTimezone, setSelectedTimezone] = useState<TimezoneOption>(TIMEZONE_OPTIONS[0])

  const loadUsageStats = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/tokens?action=stats&timeframe=${selectedTimeframe}`, { signal: AbortSignal.timeout(8000) })
      const data = await response.json()
      setUsageStats(data)
    } catch (error) {
      log.error('Failed to load usage stats:', error)
    } finally {
      setIsLoading(false)
    }
  }, [selectedTimeframe])

  const loadTrendData = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`/api/tokens?action=trends&timeframe=${selectedTimeframe}`, { signal: AbortSignal.timeout(8000) })
      const data = await response.json()
      setTrendData(data)
    } catch (error) {
      log.error('Failed to load trend data:', error)
    }
  }, [selectedTimeframe])

  const loadSessionCosts = useCallback(async (): Promise<void> => {
    const buildFallback = (): SessionCostEntry[] => {
      if (!usageStats?.sessions) return []
      return Object.entries(usageStats.sessions).map(([sessionId, stats]) => {
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
    }

    try {
      const response = await fetch(`/api/tokens?action=session-costs&timeframe=${selectedTimeframe}`, { signal: AbortSignal.timeout(8000) })
      const data = await response.json()
      if (Array.isArray(data?.sessions)) {
        setSessionCosts(data.sessions)
      } else {
        setSessionCosts(buildFallback())
      }
    } catch {
      setSessionCosts(buildFallback())
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

    const filteredModels: typeof usageStats.models = {}
    const filteredSessions: typeof usageStats.sessions = {}

    for (const [model, stats] of Object.entries(usageStats.models)) {
      if (modelFilters.size > 0 && !modelFilters.has(model)) continue
      filteredModels[model] = stats
    }
    for (const [sessionId, stats] of Object.entries(usageStats.sessions)) {
      if (sessionFilters.size > 0 && !sessionFilters.has(sessionId)) continue
      filteredSessions[sessionId] = stats
    }

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

  const exportClientCsv = useCallback((): void => {
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
        rows.push([
          entry.lastSeen || new Date().toISOString(), `"${entry.model}"`, `"${entry.sessionId}"`,
          entry.inputTokens, entry.outputTokens, entry.totalTokens, entry.totalCost.toFixed(4),
        ].join(','))
      }
      downloadText(rows.join('\n'), `usage-${selectedTimeframe}-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv')
    } catch (error) {
      log.error('Client CSV export failed:', error)
    } finally {
      setIsExporting(false)
    }
  }, [filteredUsageStats, sessionCosts, selectedTimeframe])

  const exportData = async (format: 'json' | 'csv'): Promise<void> => {
    setIsExporting(true)
    try {
      const response = await fetch(`/api/tokens?action=export&timeframe=${selectedTimeframe}&format=${format}`, { signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error('Export failed')
      const blob = await response.blob()
      downloadBlob(blob, `token-usage-${selectedTimeframe}-${new Date().toISOString().split('T')[0]}.${format}`)
    } catch (error) {
      log.error('Export failed:', error)
    } finally {
      setIsExporting(false)
    }
  }

  const toggleModelFilter = (model: string): void => {
    setModelFilters(prev => {
      const next = new Set(prev)
      if (next.has(model)) { next.delete(model) } else { next.add(model) }
      return next
    })
  }

  const toggleSessionFilter = (sessionId: string): void => {
    setSessionFilters(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) { next.delete(sessionId) } else { next.add(sessionId) }
      return next
    })
  }

  const clearAllFilters = (): void => {
    setModelFilters(new Set())
    setSessionFilters(new Set())
  }

  const sortedSessionCosts = [...sessionCosts].sort((a, b) => {
    switch (sessionSort) {
      case 'cost': return b.totalCost - a.totalCost
      case 'tokens': return b.totalTokens - a.totalTokens
      case 'requests': return b.requestCount - a.requestCount
      case 'recent': return (b.lastSeen || '').localeCompare(a.lastSeen || '')
      default: return 0
    }
  })

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

  const peakTrendHour = useMemo(
    () => getPeakTrendHour(trendData, selectedTimezone),
    [trendData, selectedTimezone],
  )

  const performanceMetrics = useMemo(
    () => getPerformanceMetrics(filteredUsageStats),
    [filteredUsageStats],
  )

  const alerts = useMemo(
    () => getAlerts(filteredUsageStats, performanceMetrics),
    [filteredUsageStats, performanceMetrics],
  )

  const availableModels = useMemo(() => {
    if (!usageStats?.models) return []
    return Object.keys(usageStats.models).sort()
  }, [usageStats])

  const availableSessions = useMemo(() => {
    if (!usageStats?.sessions) return []
    return Object.keys(usageStats.sessions).sort()
  }, [usageStats])

  const hasActiveFilters = modelFilters.size > 0 || sessionFilters.size > 0

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Token &amp; Cost Dashboard</h1>
            <p className="text-muted-foreground mt-2">Monitor token usage and costs across models and sessions</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setView('overview')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'overview' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
              >
                Overview
              </button>
              <button
                onClick={() => setView('sessions')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${view === 'sessions' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
              >
                Sessions
              </button>
            </div>
            <div className="flex space-x-2">
              {(['hour', 'day', 'week', 'month'] as const).map(timeframe => (
                <Button
                  key={timeframe}
                  onClick={() => setSelectedTimeframe(timeframe)}
                  variant={selectedTimeframe === timeframe ? 'default' : 'secondary'}
                >
                  {timeframe.charAt(0).toUpperCase() + timeframe.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Filter Chips */}
      {view === 'overview' && usageStats && (availableModels.length > 0 || availableSessions.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">Filters:</span>
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
              {model.split('/').pop() || model}
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
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Timezone Selector */}
      {view === 'overview' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Timezone:</span>
          <select
            value={selectedTimezone.label}
            onChange={e => {
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

      {/* Main Content */}
      {view === 'sessions' ? (
        <SessionsView
          sortedSessionCosts={sortedSessionCosts}
          sessionSort={sessionSort}
          onSortChange={setSessionSort}
          sessions={sessions}
        />
      ) : isLoading ? (
        <Loader variant="panel" label="Loading usage data" />
      ) : filteredUsageStats ? (
        <div className="space-y-6">
          <StatsCards
            stats={filteredUsageStats}
            selectedTimeframe={selectedTimeframe}
            cacheStats={cacheStats}
          />
          <ChartsSection
            filteredUsageStats={filteredUsageStats}
            trendData={trendData}
            chartMode={chartMode}
            selectedTimeframe={selectedTimeframe}
            peakTrendHour={peakTrendHour}
            selectedTimezone={selectedTimezone}
            onChartModeChange={setChartMode}
          />
          <InsightsSection
            filteredUsageStats={filteredUsageStats}
            performanceMetrics={performanceMetrics}
            alerts={alerts}
            isExporting={isExporting}
            sessions={sessions}
            onExportClientCsv={exportClientCsv}
            onExportData={exportData}
          />
        </div>
      ) : (
        <div className="text-center text-muted-foreground py-12">
          <div className="text-lg mb-2">No usage data available</div>
          <div className="text-sm">Token usage will appear here once agents start running</div>
          <Button onClick={loadUsageStats} className="mt-4">Refresh</Button>
        </div>
      )}
    </div>
  )
}
