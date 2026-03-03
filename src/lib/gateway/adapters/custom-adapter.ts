/**
 * Custom gateway adapter — a REST/WebSocket-based adapter template
 * for integrating arbitrary AI agent backends.
 *
 * Implements the GatewayAdapter interface with configurable endpoints.
 * Users can extend this adapter or use adapter_config to point at their
 * own agent orchestration APIs.
 */

import { EventEmitter } from 'events'
import type {
  GatewayAdapter,
  GatewayConfig,
  GatewayStatus,
  GatewaySession,
  GatewayLogEntry,
  GatewayCapabilities,
  SpawnRequest,
  SpawnResult,
} from '../types'

export class CustomGatewayAdapter extends EventEmitter implements GatewayAdapter {
  readonly type = 'custom' as const
  readonly displayName = 'Custom REST Gateway'

  private config: GatewayConfig | null = null
  private connected = false

  async connect(config: GatewayConfig): Promise<void> {
    this.config = config
    try {
      const status = await this.probe(config)
      this.connected = status.connected
      if (!status.connected) {
        throw new Error(status.error || 'Failed to connect')
      }
    } catch (err: any) {
      this.connected = false
      this.emit('error', err)
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false
    this.emit('disconnect')
  }

  isConnected(): boolean {
    return this.connected
  }

  async probe(config: GatewayConfig): Promise<GatewayStatus> {
    const baseUrl = `http://${config.host}:${config.port}`
    const healthPath = config.adapter_config?.health_path || '/health'

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const start = Date.now()

      const res = await fetch(`${baseUrl}${healthPath}`, {
        signal: controller.signal,
        headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
      })
      clearTimeout(timeout)

      const latency = Date.now() - start
      const data = await res.json().catch(() => ({}))

      return {
        connected: res.ok,
        latency,
        version: data.version || null,
        sessions: data.sessions ?? data.active_sessions ?? 0,
        agents: data.agents ?? data.active_agents ?? 0,
        error: res.ok ? null : `HTTP ${res.status}`,
      }
    } catch (err: any) {
      return {
        connected: false,
        latency: null,
        version: null,
        sessions: 0,
        agents: 0,
        error: err.message || 'Connection failed',
      }
    }
  }

  async getSessions(): Promise<GatewaySession[]> {
    if (!this.config) return []

    const baseUrl = `http://${this.config.host}:${this.config.port}`
    const sessionsPath = this.config.adapter_config?.sessions_path || '/sessions'

    try {
      const res = await fetch(`${baseUrl}${sessionsPath}`, {
        headers: this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {},
      })
      if (!res.ok) return []
      const data = await res.json()
      const sessions = Array.isArray(data) ? data : data.sessions || []

      return sessions.map((s: any) => ({
        id: s.id || s.session_id || '',
        agent: s.agent || s.agent_name || 'unknown',
        model: s.model || s.model_name || 'unknown',
        status: s.status || 'active',
        chatType: s.chat_type || s.type || 'chat',
        totalTokens: s.total_tokens || s.totalTokens || 0,
        inputTokens: s.input_tokens || s.inputTokens || 0,
        outputTokens: s.output_tokens || s.outputTokens || 0,
        startedAt: s.started_at || s.startedAt || Date.now(),
        updatedAt: s.updated_at || s.updatedAt || Date.now(),
        metadata: s.metadata || {},
      }))
    } catch {
      return []
    }
  }

  async spawn(request: SpawnRequest): Promise<SpawnResult> {
    if (!this.config) {
      return { sessionId: '', success: false, error: 'Not connected' }
    }

    const baseUrl = `http://${this.config.host}:${this.config.port}`
    const spawnPath = this.config.adapter_config?.spawn_path || '/spawn'

    try {
      const res = await fetch(`${baseUrl}${spawnPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
        },
        body: JSON.stringify(request),
      })

      const data = await res.json()
      if (!res.ok) {
        return { sessionId: '', success: false, error: data.error || `HTTP ${res.status}` }
      }

      return {
        sessionId: data.session_id || data.sessionId || data.id || '',
        success: true,
      }
    } catch (err: any) {
      return { sessionId: '', success: false, error: err.message }
    }
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    if (!this.config) throw new Error('Not connected')

    const baseUrl = `http://${this.config.host}:${this.config.port}`
    const messagePath = this.config.adapter_config?.message_path || `/sessions/${sessionId}/message`

    await fetch(`${baseUrl}${messagePath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
      },
      body: JSON.stringify({ message }),
    })
  }

  async terminateSession(sessionId: string): Promise<void> {
    if (!this.config) throw new Error('Not connected')

    const baseUrl = `http://${this.config.host}:${this.config.port}`
    const terminatePath = this.config.adapter_config?.terminate_path || `/sessions/${sessionId}`

    await fetch(`${baseUrl}${terminatePath}`, {
      method: 'DELETE',
      headers: this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {},
    })
  }

  // EventEmitter 'on' and 'off' are inherited

  getCapabilities(): GatewayCapabilities {
    const cfg = this.config?.adapter_config || {}
    return {
      canSpawn: cfg.can_spawn !== false,
      canTerminate: cfg.can_terminate !== false,
      hasLogStreaming: !!cfg.log_stream_path,
      hasCronJobs: false,
      hasMemoryBrowser: !!cfg.memory_path,
      hasAgentComms: false,
      hasPauseResume: false,
      hasSoulEndpoint: false,
    }
  }
}
