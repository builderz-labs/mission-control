'use client'

// ---------------------------------------------------------------------------
// WebSocket — shared types and constants
// ---------------------------------------------------------------------------

export interface GatewayFrame {
  type: 'event' | 'req' | 'res'
  event?: string
  method?: string
  id?: string
  payload?: any
  ok?: boolean
  result?: any
  error?: { message?: string; code?: string; details?: any; [key: string]: any }
  params?: any
  seq?: number
}

export interface GatewayMessage {
  type: 'session_update' | 'log' | 'event' | 'status' | 'spawn_result' | 'cron_status' | 'pong'
  data: any
  timestamp?: number
}

// Gateway protocol version (v3 required by OpenClaw 2026.x)
export const PROTOCOL_VERSION = 3

// Gateway validates client IDs against a strict allowlist ('anyOf' schema).
// 'openclaw-control-ui' is the registered constant — 'control-ui' is rejected.
// Override via NEXT_PUBLIC_GATEWAY_CLIENT_ID for custom deployments.
export const DEFAULT_GATEWAY_CLIENT_ID = process.env.NEXT_PUBLIC_GATEWAY_CLIENT_ID || 'openclaw-control-ui'

export const PING_INTERVAL_MS = 30_000
export const MAX_MISSED_PONGS = 3
export const ERROR_LOG_DEDUPE_MS = 5_000
