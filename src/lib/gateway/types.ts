/**
 * Agent-agnostic gateway abstraction types.
 *
 * Gateway adapters implement the GatewayAdapter interface to bridge
 * Mission Control with different AI agent backends (OpenClaw, LangGraph,
 * CrewAI, AutoGen, custom, etc.).
 */

export type GatewayType = 'openclaw' | 'langgraph' | 'crewai' | 'autogen' | 'custom'

export interface GatewayConfig {
  id: number
  name: string
  type: GatewayType
  host: string
  port: number
  token: string
  is_primary: boolean
  /** Extra adapter-specific configuration (JSON string in DB) */
  adapter_config?: Record<string, any>
}

export interface GatewayStatus {
  connected: boolean
  latency: number | null
  version: string | null
  sessions: number
  agents: number
  error: string | null
}

export interface GatewaySession {
  id: string
  agent: string
  model: string
  status: 'active' | 'idle' | 'terminated'
  chatType: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  startedAt: number
  updatedAt: number
  metadata?: Record<string, any>
}

export interface GatewayLogEntry {
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  source: string
  metadata?: Record<string, any>
}

export interface SpawnRequest {
  agent: string
  model?: string
  prompt?: string
  config?: Record<string, any>
}

export interface SpawnResult {
  sessionId: string
  success: boolean
  error?: string
}

/**
 * GatewayAdapter — interface that all gateway backends must implement.
 * Each adapter bridges Mission Control's generic operations to the
 * specific protocol of an AI agent backend.
 */
export interface GatewayAdapter {
  /** Unique adapter type identifier */
  readonly type: GatewayType

  /** Human-readable adapter name */
  readonly displayName: string

  /** Connect to the gateway */
  connect(config: GatewayConfig): Promise<void>

  /** Disconnect from the gateway */
  disconnect(): Promise<void>

  /** Check if currently connected */
  isConnected(): boolean

  /** Probe the gateway and return its status */
  probe(config: GatewayConfig): Promise<GatewayStatus>

  /** List active sessions */
  getSessions(): Promise<GatewaySession[]>

  /** Spawn a new agent session */
  spawn(request: SpawnRequest): Promise<SpawnResult>

  /** Send a message/command to a specific session */
  sendMessage(sessionId: string, message: string): Promise<void>

  /** Terminate a session */
  terminateSession(sessionId: string): Promise<void>

  /** Register event handlers */
  on(event: 'session_update', handler: (session: GatewaySession) => void): void
  on(event: 'log', handler: (entry: GatewayLogEntry) => void): void
  on(event: 'token_usage', handler: (data: { sessionId: string; model: string; input: number; output: number }) => void): void
  on(event: 'agent_status', handler: (data: { agent: string; status: string }) => void): void
  on(event: 'error', handler: (error: Error) => void): void
  on(event: 'disconnect', handler: () => void): void

  /** Remove event handlers */
  off(event: string, handler: (...args: any[]) => void): void

  /** Get adapter-specific capabilities */
  getCapabilities(): GatewayCapabilities
}

export interface GatewayCapabilities {
  /** Can spawn new agent sessions */
  canSpawn: boolean
  /** Can terminate running sessions */
  canTerminate: boolean
  /** Supports real-time log streaming */
  hasLogStreaming: boolean
  /** Supports cron/scheduled jobs */
  hasCronJobs: boolean
  /** Supports memory browsing */
  hasMemoryBrowser: boolean
  /** Supports agent-to-agent communication */
  hasAgentComms: boolean
  /** Supports session pause/resume */
  hasPauseResume: boolean
  /** Supports the soul/persona endpoint */
  hasSoulEndpoint: boolean
}
