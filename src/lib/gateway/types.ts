// Gateway protocol types

export const PROTOCOL_VERSION = 3

export type GatewayState = 'idle' | 'connecting' | 'handshaking' | 'connected' | 'disconnected'

export type GatewayEvent =
    | 'state'
    | 'tick'
    | 'log'
    | 'chat.message'
    | 'notification'
    | 'agent.status'
    | 'latency'
    | 'error'
    | 'spawn_result'
    | 'cron_status'
    | 'token_usage'

export interface GatewayFrame {
    type: 'event' | 'req' | 'res'
    event?: string
    method?: string
    id?: string
    payload?: any
    ok?: boolean
    result?: any
    error?: any
    params?: any
}

export interface GatewayConfig {
    protocolVersion: number
    pingIntervalMs: number
    maxMissedPongs: number
    maxReconnectAttempts: number
}

export interface QueuedMessage {
    data: unknown
    timestamp: number
}

export const DEFAULT_CONFIG: GatewayConfig = {
    protocolVersion: PROTOCOL_VERSION,
    pingIntervalMs: 30_000,
    maxMissedPongs: 3,
    maxReconnectAttempts: 10,
}
