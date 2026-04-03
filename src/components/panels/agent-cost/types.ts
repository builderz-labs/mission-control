// Types for agent-cost panel
export type Timeframe = 'hour' | 'day' | 'week' | 'month'
export type ActiveView = 'overview' | 'per-agent'
export type ExpandedSection = 'models' | 'tasks'

export interface TokenStats {
  totalTokens: number
  totalCost: number
  requestCount: number
  avgTokensPerRequest: number
  avgCostPerRequest: number
}

export interface AgentCostData {
  stats: TokenStats
  models: Record<string, { totalTokens: number; totalCost: number; requestCount: number }>
  sessions: string[]
  timeline: Array<{ date: string; cost: number; tokens: number }>
}

export interface AgentCostsResponse {
  agents: Record<string, AgentCostData>
  timeframe: string
  recordCount: number
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
  summary: {
    total_cost: number
    total_tokens: number
    agent_count: number
    days: number
  }
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

// Chart-ready shapes
export interface PieSlice {
  name: string
  value: number
}

export interface TrendPoint {
  date: string
  [agentName: string]: string | number
}

export interface EfficiencyBar {
  name: string
  costPer1k: number
}
