// Types for session-details panel — kept separate for clean imports
export type TimeWindow = '1h' | '6h' | '24h' | '7d' | 'all'
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type VerboseLevel = 'off' | 'on' | 'full'
export type ReasoningLevel = 'off' | 'on' | 'stream'
export type SessionFilter = 'all' | 'active' | 'idle'
export type SortBy = 'age' | 'tokens' | 'model'

export interface TokenUsage {
  used: number
  total: number
  percentage: number
}

export interface ModelInfo {
  alias: string
  name: string
  provider: string
  description: string
}

// Matches the shape coming from /api/sessions
export interface Session {
  id: string
  key: string
  kind: string
  model: string
  tokens: string
  age: string
  active: boolean
  flags: string[]
  label?: string
  lastActivity?: number
  messageCount?: number
}
