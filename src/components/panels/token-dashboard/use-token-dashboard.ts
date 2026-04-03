'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useMissionControl } from '@/store'
import { createClientLogger } from '@/lib/client-logger'
import { downloadText, downloadBlob } from '@/lib/download'
import { TIMEZONE_OPTIONS } from './constants'
import { getPeakTrendHour, getPerformanceMetrics, getAlerts } from './chart-helpers'
import type {
  UsageStats, TrendData, DashboardView, SessionCostEntry, TimezoneOption,
} from './types'

const log = createClientLogger('TokenDashboard')

export interface TokenDashboardState {
  selectedTimeframe: 'hour' | 'day' | 'week' | 'month'
  usageStats: UsageStats | null
  trendData: TrendData | null
  isLoading: boolean
  isExporting: boolean
  view: DashboardView
  sessionCosts: SessionCostEntry[]
  sessionSort: 'cost' | 'tokens' | 'requests' | 'recent'
  chartMode: 'incremental' | 'cumulative'
  modelFilters: Set<string>
  sessionFilters: Set<string>
  selectedTimezone: TimezoneOption
  filteredUsageStats: UsageStats | null
  sortedSessionCosts: SessionCostEntry[]
  cacheStats: { cacheRead: number; cacheWrite: number } | null
  peakTrendHour: ReturnType<typeof getPeakTrendHour>
  performanceMetrics: ReturnType<typeof getPerformanceMetrics>
  alerts: ReturnType<typeof getAlerts>
  availableModels: string[]
  availableSessions: string[]
  hasActiveFilters: boolean
}

export interface TokenDashboardActions {
  setSelectedTimeframe: (tf: 'hour' | 'day' | 'week' | 'month') => void
  setView: (v: DashboardView) => void
  setSessionSort: (s: 'cost' | 'tokens' | 'requests' | 'recent') => void
  setChartMode: (m: 'incremental' | 'cumulative') => void
  setSelectedTimezone: (tz: TimezoneOption) => void
  toggleModelFilter: (model: string) => void
  toggleSessionFilter: (sessionId: string) => void
  clearAllFilters: () => void
  loadUsageStats: () => Promise<void>
  exportClientCsv: () => void
  exportData: (format: 'json' | 'csv') => Promise<void>
}

export function useTokenDashboard(): TokenDashboardState & TokenDashboardActions {
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

  return {
    selectedTimeframe, usageStats, trendData, isLoading, isExporting,
    view, sessionCosts, sessionSort, chartMode, modelFilters, sessionFilters,
    selectedTimezone, filteredUsageStats, sortedSessionCosts, cacheStats,
    peakTrendHour, performanceMetrics, alerts, availableModels, availableSessions,
    hasActiveFilters,
    setSelectedTimeframe, setView, setSessionSort, setChartMode, setSelectedTimezone,
    toggleModelFilter, toggleSessionFilter, clearAllFilters, loadUsageStats,
    exportClientCsv, exportData,
  }
}
