// Types shared across the multi-gateway panel and its sub-components.

export interface Gateway {
  id: number
  name: string
  host: string
  port: number
  token_set: boolean
  is_primary: number
  status: string
  last_seen: number | null
  latency: number | null
  sessions_count: number
  agents_count: number
  created_at: number
  updated_at: number
}

export interface DirectConnection {
  id: number
  agent_id: number
  tool_name: string
  tool_version: string | null
  connection_id: string
  status: string
  last_heartbeat: number | null
  metadata: string | null
  created_at: number
  agent_name: string
  agent_status: string
  agent_role: string
}

export interface GatewayHealthProbe {
  id: number
  name: string
  status: 'online' | 'offline' | 'error'
  latency: number | null
  gateway_version?: string | null
  compatibility_warning?: string
  error?: string
}

export interface GatewayHealthLogEntry {
  status: string
  latency: number | null
  probed_at: number
  error: string | null
}

export interface GatewayHistory {
  gatewayId: number
  name: string | null
  entries: GatewayHealthLogEntry[]
}

export interface DiscoveredGateway {
  user: string
  port: number
  bind: string
  mode: string
  active: boolean
  tailscale?: { mode: string }
}
