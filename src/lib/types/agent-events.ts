/**
 * Agent event types for the Python → Dashboard communication bridge.
 *
 * Python agents POST these events to /api/events/ingest.
 * The event bus broadcasts them to connected SSE clients.
 * The client-side useServerEvents hook dispatches them to the Zustand store.
 */

// All possible agent event types
export type AgentEventType =
  | 'agent.heartbeat'
  | 'agent.status_changed'
  | 'agent.trade_opened'
  | 'agent.trade_closed'
  | 'agent.trade_error'
  | 'agent.signal_generated'
  | 'agent.position_update'
  | 'agent.pnl_update'
  | 'agent.risk_alert'
  | 'agent.config_changed'
  | 'agent.backtest_started'
  | 'agent.backtest_completed'
  | 'agent.log'

// Base event shape — all events have these fields
export interface AgentEventBase {
  type: AgentEventType
  agent_name: string
  timestamp: number // Unix ms
  subsystem: 'mission-control' | 'moon-dev' | 'agent-zero'
}

// Heartbeat — "I'm alive"
export interface HeartbeatEvent extends AgentEventBase {
  type: 'agent.heartbeat'
  status: 'idle' | 'busy' | 'error'
  uptime_seconds?: number
  memory_mb?: number
}

// Status change
export interface StatusChangedEvent extends AgentEventBase {
  type: 'agent.status_changed'
  old_status: string
  new_status: string
  reason?: string
}

// Trade opened
export interface TradeOpenedEvent extends AgentEventBase {
  type: 'agent.trade_opened'
  trade_id: string
  symbol: string
  side: 'long' | 'short'
  size_usd: number
  entry_price: number
  exchange: string
  strategy?: string
}

// Trade closed
export interface TradeClosedEvent extends AgentEventBase {
  type: 'agent.trade_closed'
  trade_id: string
  symbol: string
  side: 'long' | 'short'
  size_usd: number
  entry_price: number
  exit_price: number
  pnl_usd: number
  pnl_pct: number
  exchange: string
  duration_minutes: number
  strategy?: string
}

// Trade error
export interface TradeErrorEvent extends AgentEventBase {
  type: 'agent.trade_error'
  symbol: string
  error_message: string
  error_code?: string
  exchange: string
}

// Signal generated (agent detected a trading opportunity)
export interface SignalEvent extends AgentEventBase {
  type: 'agent.signal_generated'
  symbol: string
  direction: 'long' | 'short' | 'neutral'
  confidence: number // 0-1
  strategy: string
  timeframe: string
}

// Position update (periodic snapshot of open positions)
export interface PositionUpdateEvent extends AgentEventBase {
  type: 'agent.position_update'
  positions: Array<{
    symbol: string
    side: 'long' | 'short'
    size_usd: number
    unrealized_pnl: number
    entry_price: number
    current_price: number
  }>
}

// P&L update (periodic P&L snapshot)
export interface PnlUpdateEvent extends AgentEventBase {
  type: 'agent.pnl_update'
  pnl_today: number
  pnl_total: number
  win_rate: number
  open_positions: number
}

// Risk alert (kill switch, drawdown warning, etc.)
export interface RiskAlertEvent extends AgentEventBase {
  type: 'agent.risk_alert'
  severity: 'warning' | 'critical'
  alert_type: 'drawdown' | 'kill_switch' | 'exposure_limit' | 'loss_streak' | 'other'
  message: string
  current_value?: number
  threshold?: number
}

// Config changed
export interface ConfigChangedEvent extends AgentEventBase {
  type: 'agent.config_changed'
  changed_keys: string[]
  source: 'dashboard' | 'agent' | 'manual'
}

// Backtest started
export interface BacktestStartedEvent extends AgentEventBase {
  type: 'agent.backtest_started'
  strategy: string
  symbol: string
  timeframe: string
}

// Backtest completed
export interface BacktestCompletedEvent extends AgentEventBase {
  type: 'agent.backtest_completed'
  strategy: string
  symbol: string
  roi: number
  sharpe: number
  total_trades: number
  win_rate: number
}

// Generic log message
export interface AgentLogEvent extends AgentEventBase {
  type: 'agent.log'
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  context?: Record<string, unknown>
}

// Union type of all events
export type AgentEvent =
  | HeartbeatEvent
  | StatusChangedEvent
  | TradeOpenedEvent
  | TradeClosedEvent
  | TradeErrorEvent
  | SignalEvent
  | PositionUpdateEvent
  | PnlUpdateEvent
  | RiskAlertEvent
  | ConfigChangedEvent
  | BacktestStartedEvent
  | BacktestCompletedEvent
  | AgentLogEvent

// Validation: check if a value is a valid AgentEventType
export const VALID_EVENT_TYPES: AgentEventType[] = [
  'agent.heartbeat',
  'agent.status_changed',
  'agent.trade_opened',
  'agent.trade_closed',
  'agent.trade_error',
  'agent.signal_generated',
  'agent.position_update',
  'agent.pnl_update',
  'agent.risk_alert',
  'agent.config_changed',
  'agent.backtest_started',
  'agent.backtest_completed',
  'agent.log',
]

export function isValidEventType(type: string): type is AgentEventType {
  return VALID_EVENT_TYPES.includes(type as AgentEventType)
}
