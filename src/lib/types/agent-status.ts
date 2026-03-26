import type { Agent } from '@/store/index'

// Status type used by StatusBadge component
export type StatusBadgeStatus =
  | 'running'
  | 'stopped'
  | 'crashed'
  | 'degraded'
  | 'idle'
  | 'busy'
  | 'offline'
  | 'unknown'

// Trading-specific extension fields for agents
export interface TradingAgentStatus {
  subsystem: 'mission-control' | 'moon-dev' | 'agent-zero'
  category:
    | 'trading'
    | 'market-analysis'
    | 'research'
    | 'content'
    | 'arbitrage'
    | 'risk'
    | 'orchestration'
    | 'devtools'
  strategy?: string
  pnl_today?: number
  pnl_total?: number
  open_positions?: number
  win_rate?: number
  uptime_pct?: number
  last_trade?: number
  error_count_24h?: number
}

// Combines the store Agent type with trading-specific fields
export type UnifiedAgent = Agent & TradingAgentStatus

// Filter options for agent status views
export type AgentStatusFilter = 'all' | 'running' | 'idle' | 'offline' | 'error'

// Fields that agents can be sorted by
export type AgentSortField =
  | 'name'
  | 'status'
  | 'pnl_today'
  | 'last_seen'
  | 'category'
  | 'open_positions'

/**
 * Maps the store's Agent status to the StatusBadge component status type.
 */
export function mapAgentStatus(status: Agent['status']): StatusBadgeStatus {
  switch (status) {
    case 'busy':
      return 'running'
    case 'idle':
      return 'idle'
    case 'offline':
      return 'offline'
    case 'error':
      return 'crashed'
    default:
      return 'unknown'
  }
}

/**
 * Returns a numeric priority for sorting agents by status severity.
 * Lower numbers = higher severity (shown first).
 */
export function getAgentStatusPriority(status: string): number {
  switch (status) {
    case 'error':
      return 0
    case 'busy':
      return 1
    case 'degraded':
      return 2
    case 'idle':
      return 3
    case 'offline':
      return 4
    default:
      return 5
  }
}
