// Types for the Cost Tracker panel

export interface TokenStats {
  totalTokens: number
  totalCost: number
  requestCount: number
  avgTokensPerRequest: number
  avgCostPerRequest: number
}

export interface UsageStats {
  summary: TokenStats
  models: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  sessions: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  timeframe: string
  recordCount: number
}

export interface TrendData {
  trends: Array<{ timestamp: string; tokens: number; cost: number; requests: number }>
  timeframe: string
}

export interface ByAgentModelBreakdown {
  model: string
  input_tokens: number
  output_tokens: number
  request_count: number
  cost: number
}

export interface ByAgentEntry {
  agent: string
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  total_cost: number
  session_count: number
  request_count: number
  last_active: string
  models: ByAgentModelBreakdown[]
}

export interface ByAgentResponse {
  agents: ByAgentEntry[]
  summary: { total_cost: number; total_tokens: number; agent_count: number; days: number }
}

export interface TaskCostEntry {
  taskId: number
  title: string
  status: string
  priority: string
  assignedTo?: string | null
  project: {
    id?: number | null
    name?: string | null
    slug?: string | null
    ticketRef?: string | null
  }
  stats: TokenStats
  models: Record<string, TokenStats>
}

export interface TaskCostsResponse {
  summary: TokenStats
  tasks: TaskCostEntry[]
  agents: Record<string, { stats: TokenStats; taskCount: number; taskIds: number[] }>
  unattributed: TokenStats
  timeframe: string
}

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

export type View = 'overview' | 'agents' | 'sessions' | 'tasks'
export type Timeframe = 'hour' | 'day' | 'week' | 'month'
