'use client'

// Primitive JSON value — used across all slice types
export type JsonPrimitive = string | number | boolean | null

// Recursive JSON value type covering all JSON-serialisable shapes
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue | undefined }

// WebSocket / SSE connection state
export interface ConnectionStatus {
  isConnected: boolean
  url: string
  lastConnected?: Date
  reconnectAttempts: number
  latency?: number
  sseConnected?: boolean
}
