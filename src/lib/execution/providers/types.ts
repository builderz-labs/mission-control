/**
 * Execution Provider Interface
 *
 * Defines the contract all execution providers must implement.
 * The OpenClaw provider is the only concrete implementation today;
 * this boundary allows alternative providers without changing call sites.
 */

export interface ProviderCapabilities {
  spawn: boolean
  kill: boolean
  send: boolean
  transcripts: boolean
  dispatch: boolean
}

export interface ProviderInfo {
  id: string
  version?: string
  capabilities: ProviderCapabilities
}

export interface SpawnParams {
  task: string
  label?: string
  model?: string
  runTimeoutSeconds?: number
  tools?: { profile: string }
}

/** Parameters for agent-invocation dispatch (new session, expect-final response). */
export interface DispatchParams {
  agentId: string
  message: string
  idempotencyKey?: string
  model?: string
  deliver?: boolean
  timeoutMs?: number
}

/** Raw stdout/stderr from an agent dispatch — callers parse response text. */
export interface RawDispatchResult {
  stdout: string
  stderr: string
}

/** Parameters for sending a chat message to an existing active session. */
export interface ChatSendParams {
  message: string
  idempotencyKey?: string
  deliver?: boolean
  timeoutMs?: number
}

/** Response from chat.send — fire-and-forget; the session processes asynchronously. */
export interface ChatSendResult {
  status: string
  runId?: string | null
}

export type ProviderErrorCode =
  | 'UNAVAILABLE'
  | 'SPAWN_FAILED'
  | 'KILL_FAILED'
  | 'SEND_FAILED'
  | 'CHAT_SEND_FAILED'
  | 'DISPATCH_FAILED'
  | 'UNKNOWN'

export interface ProviderError {
  provider: string
  code: ProviderErrorCode
  message: string
  cause?: unknown
}

/** meta carries provider-specific context (e.g. compatibility fallback flags). */
export type ProviderResult<T> =
  | { ok: true; data: T; meta?: Record<string, unknown> }
  | { ok: false; error: ProviderError }

/** Structured telemetry emitted alongside every provider call. */
export interface ProviderCallTelemetry {
  provider: string
  method: string
  duration_ms: number
  success: boolean
  error_code?: ProviderErrorCode
}

export interface ExecutionProvider {
  /** Stable identifier for this provider (e.g. "openclaw"). */
  readonly id: string
  /** Return provider info and capability declaration. Should not throw. */
  info(): Promise<ProviderResult<ProviderInfo>>
  /** Spawn a new agent session. */
  spawn(params: SpawnParams): Promise<ProviderResult<unknown>>
  /** Terminate a session by key. */
  kill(sessionKey: string): Promise<ProviderResult<unknown>>
  /** Send a control message to a session (sessions_send). */
  send(sessionKey: string, message: unknown): Promise<ProviderResult<unknown>>
  /** Invoke an agent with a message and wait for the final response (new session). */
  dispatch(params: DispatchParams): Promise<ProviderResult<RawDispatchResult>>
  /**
   * Send a chat message to an existing active session (chat.send).
   * Fire-and-forget: returns immediately after acknowledgement.
   */
  chatSend(sessionKey: string, params: ChatSendParams): Promise<ProviderResult<ChatSendResult>>
}
