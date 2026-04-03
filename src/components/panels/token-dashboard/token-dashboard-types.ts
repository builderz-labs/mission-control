// Shared types, constants, and pure utility functions for the token-dashboard panel.
// All helpers here are pure functions with no React/hook dependencies.

export interface UsageStats {
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

export interface TrendData {
  trends: Array<{ timestamp: string; tokens: number; cost: number; requests: number }>
  timeframe: string
}

export type DashboardView = 'overview' | 'sessions'

export interface SessionCostEntry {
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

export type TimezoneOption = { label: string; offset: number }

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
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

export const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d']

export const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: '#d97706',
  OpenAI: '#10b981',
  Google: '#3b82f6',
  Mistral: '#f97316',
  Meta: '#6366f1',
  DeepSeek: '#06b6d4',
  Cohere: '#ec4899',
  Other: '#6b7280',
}

export interface PerformanceMetrics {
  mostEfficient: { model: string; stats: { totalTokens: number; totalCost: number; requestCount: number } }
  mostUsed: { model: string; stats: { totalTokens: number; totalCost: number; requestCount: number } }
  mostExpensive: { model: string; stats: { totalTokens: number; totalCost: number; requestCount: number } }
  potentialSavings: number
  savingsPercentage: number
}

export interface AlertEntry {
  type: 'warning' | 'info'
  title: string
  message: string
  suggestion: string
}

// Pure formatting helpers
export const formatNumber = (num: number): string => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}

export const formatCost = (cost: number): string => '$' + cost.toFixed(4)

export const getModelDisplayName = (modelName: string): string => {
  const parts = modelName.split('/')
  return parts[parts.length - 1] || modelName
}

// Pure domain helpers used by the parent shell

export function buildFallbackSessionCosts(
  usageStats: UsageStats,
  sessions: { id: string; key?: string }[],
): SessionCostEntry[] {
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

export function applyFilters(
  usageStats: UsageStats,
  modelFilters: Set<string>,
  sessionFilters: Set<string>,
): UsageStats {
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
}

export function computePerformanceMetrics(filteredUsageStats: UsageStats | null): PerformanceMetrics | null {
  if (!filteredUsageStats?.models) return null
  const models = Object.entries(filteredUsageStats.models)
  if (models.length === 0) return null

  const cpt = (stats: { totalCost: number; totalTokens: number }) =>
    stats.totalCost / Math.max(1, stats.totalTokens)

  let mostEfficient = { model: models[0][0], stats: models[0][1] }
  let mostUsed = { model: models[0][0], stats: models[0][1] }
  let mostExpensive = { model: models[0][0], stats: models[0][1] }

  for (const [model, stats] of models) {
    if (cpt(stats) < cpt(mostEfficient.stats)) mostEfficient = { model, stats }
    if (stats.requestCount > mostUsed.stats.requestCount) mostUsed = { model, stats }
    if (cpt(stats) > cpt(mostExpensive.stats)) mostExpensive = { model, stats }
  }

  const currentCost = filteredUsageStats.summary.totalCost
  const potentialCost = filteredUsageStats.summary.totalTokens * cpt(mostEfficient.stats)
  const potentialSavings = Math.max(0, currentCost - potentialCost)

  return {
    mostEfficient,
    mostUsed,
    mostExpensive,
    potentialSavings,
    savingsPercentage: currentCost > 0 ? (potentialSavings / currentCost) * 100 : 0,
  }
}

export function buildAlerts(
  filteredUsageStats: UsageStats | null,
  performanceMetrics: PerformanceMetrics | null,
): AlertEntry[] {
  const alerts: AlertEntry[] = []

  if (filteredUsageStats && filteredUsageStats.summary.totalCost > 100) {
    alerts.push({
      type: 'warning',
      title: 'High Usage Cost',
      message: `Total cost of ${formatCost(filteredUsageStats.summary.totalCost)} exceeds $100 threshold`,
      suggestion: 'Consider using more cost-effective models for routine tasks',
    })
  }

  if (performanceMetrics && performanceMetrics.savingsPercentage > 20) {
    alerts.push({
      type: 'info',
      title: 'Optimization Opportunity',
      message: `Using ${getModelDisplayName(performanceMetrics.mostEfficient.model)} could save ${formatCost(performanceMetrics.potentialSavings)} (${performanceMetrics.savingsPercentage.toFixed(1)}%)`,
      suggestion: 'Consider switching routine tasks to more efficient models',
    })
  }

  if (filteredUsageStats && filteredUsageStats.summary.requestCount > 1000) {
    alerts.push({
      type: 'info',
      title: 'High Request Volume',
      message: `${filteredUsageStats.summary.requestCount} requests in selected timeframe`,
      suggestion: 'Consider implementing request batching or caching for efficiency',
    })
  }

  return alerts
}
