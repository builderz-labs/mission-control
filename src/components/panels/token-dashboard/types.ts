// Types for the Token Dashboard panel — shared across sub-components

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

export interface PerformanceMetrics {
  mostEfficient: { model: string; stats: { totalTokens: number; totalCost: number; requestCount: number } }
  mostUsed: { model: string; stats: { totalTokens: number; totalCost: number; requestCount: number } }
  mostExpensive: { model: string; stats: { totalTokens: number; totalCost: number; requestCount: number } }
  potentialSavings: number
  savingsPercentage: number
}

export interface Alert {
  type: 'warning' | 'info'
  title: string
  message: string
  suggestion: string
}
