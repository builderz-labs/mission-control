#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const CHAT_ID = /^[A-Za-z0-9_:-]{1,64}$/
const AGENT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/

/** @param {Record<string, string | undefined>} env */
export function readConfig(env = process.env) {
  const mcUrl = new URL(env.MC_URL || 'http://127.0.0.1:3000')
  const wsUrl = new URL(env.NANOBOT_WS_URL || 'ws://127.0.0.1:8765/')
  if (!['http:', 'https:'].includes(mcUrl.protocol) || !['ws:', 'wss:'].includes(wsUrl.protocol)) {
    throw new Error('MC_URL must use HTTP(S); NANOBOT_WS_URL must use WS(S)')
  }
  if (mcUrl.username || mcUrl.password || mcUrl.search || mcUrl.hash ||
      wsUrl.username || wsUrl.password || wsUrl.hash || wsUrl.searchParams.has('token')) {
    throw new Error('Use MC_API_KEY and NANOBOT_TOKEN for credentials, not URL credentials')
  }
  const chatIds = [...new Set((env.NANOBOT_CHAT_IDS || '').split(',').map(id => id.trim()).filter(Boolean))]
  if (!chatIds.length || chatIds.length > 32 || chatIds.some(id => !CHAT_ID.test(id))) {
    throw new Error('NANOBOT_CHAT_IDS must contain 1–32 comma-separated WebSocket chat IDs')
  }
  const name = env.MC_AGENT_NAME || 'nanobot-monitor'
  if (!AGENT_NAME.test(name)) throw new Error('MC_AGENT_NAME must be a valid 1–63 character agent name')
  if (!env.MC_API_KEY) throw new Error('MC_API_KEY is required (operator access)')
  if (env.NANOBOT_TOKEN) wsUrl.searchParams.set('token', env.NANOBOT_TOKEN)
  return { mcUrl, wsUrl, chatIds, name, apiKey: env.MC_API_KEY }
}

/** Observe explicitly selected chats. Never infer business-task completion. */
export class NanobotMonitor {
  constructor(chatIds) {
    this.chatIds = chatIds
    this.connected = false
    this.reset()
  }

  reset() {
    this.sessions = new Map(this.chatIds.map(id => [id, { state: 'unknown', turnId: null }]))
  }

  connect() {
    this.reset()
    this.connected = true
  }

  disconnect() {
    this.connected = false
    this.reset()
  }

  accept(frame) {
    if (!this.connected || !frame || typeof frame !== 'object') return false
    const session = this.sessions.get(frame.chat_id)
    if (!session) return false
    // An ending event for an earlier turn cannot end the current turn.
    if (frame.event !== 'goal_status' && frame.turn_id && session.turnId && frame.turn_id !== session.turnId) return false
    const previous = JSON.stringify(session)
    if (frame.event === 'goal_status' && frame.status === 'running') {
      session.state = 'running'
      session.turnId = typeof frame.turn_id === 'string' ? frame.turn_id.slice(0, 128) : null
    } else if (frame.event === 'goal_status' && frame.status === 'idle') {
      if (frame.turn_id && session.turnId && frame.turn_id !== session.turnId) return false
      if (!['failed', 'awaiting_user'].includes(session.state)) session.state = 'idle'
    } else if (frame.event === 'turn_end') {
      if (frame.outcome === 'failed' || (typeof frame.failure_kind === 'string' && frame.failure_kind)) {
        session.state = 'failed'
      } else if (frame.outcome && frame.outcome !== 'completed') {
        if (!['failed', 'awaiting_user'].includes(session.state)) session.state = 'unknown'
      } else if (!['failed', 'awaiting_user'].includes(session.state)) {
        session.state = frame.goal_state?.status === 'blocked' ? 'awaiting_user' : 'idle'
      }
    } else if (frame.event === 'goal_state' && frame.goal_state?.status === 'blocked') {
      session.state = 'awaiting_user'
    } else if (frame.event === 'recovery_state' || frame.event === 'attached') {
      const status = frame.event === 'attached' ? frame.recovery_state?.status : frame.status
      if (status === 'resuming') session.state = 'running'
      else if (status === 'awaiting_user') session.state = 'awaiting_user'
      else if (status === 'failed') session.state = 'failed'
      else if (status === 'recovered' && session.state !== 'running') session.state = 'idle'
    } else if (frame.event === 'retry_status') {
      if (frame.state === 'waiting') session.state = 'retrying'
      else if (frame.state === 'exhausted') session.state = 'failed'
      else if (frame.state === 'recovered' && session.state === 'retrying') session.state = 'running'
    }
    return previous !== JSON.stringify(session)
  }

  snapshot() {
    const counts = { unknown: 0, running: 0, retrying: 0, idle: 0, awaiting_user: 0, failed: 0 }
    for (const session of this.sessions.values()) counts[session.state]++
    const status = !this.connected ? 'offline'
      : counts.running || counts.retrying ? 'busy'
        : counts.failed ? 'error' : 'idle'
    return {
      status,
      // MC has no waiting/unknown agent status. Retain these distinctions in
      // the persisted activity and heartbeat metrics rather than inventing one.
      lastActivity: !this.connected ? 'nanobot: disconnected'
        : `nanobot: ${Object.entries(counts).map(([state, count]) => `${state}=${count}`).join(', ')}`,
      metrics: { connected: this.connected, sessions: counts },
    }
  }
}

export class MissionControlClient {
  constructor(config, fetchImpl = fetch) {
    this.config = config
    this.fetch = fetchImpl
    this.agentId = null
  }

  async request(path, body, method = 'POST') {
    const base = this.config.mcUrl.toString().replace(/\/$/, '')
    const response = await this.fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': this.config.apiKey },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    // Do not log remote bodies, URLs or network exception messages: they can
    // contain credentials, prompts or server implementation details.
    if (!response.ok) throw new Error(`Mission Control HTTP ${response.status}`)
    return response.json()
  }

  async register() {
    const result = await this.request('/api/agents/register', {
      name: this.config.name, role: 'agent', framework: 'nanobot', capabilities: ['status-observation'],
    })
    if (!Number.isSafeInteger(result.agent?.id) || result.agent.id <= 0) {
      throw new Error('Mission Control registration returned an invalid agent ID')
    }
    this.agentId = String(result.agent.id)
  }

  async publish(snapshot) {
    if (!this.agentId) throw new Error('Register before publishing')
    // Adapters emit live events only. Persist the status through the existing
    // workspace-scoped agent endpoint so a page reload retains the observation.
    await this.request('/api/agents', {
      name: this.config.name, status: snapshot.status, last_activity: snapshot.lastActivity,
    }, 'PUT')
    await this.request('/api/adapters', {
      framework: 'nanobot', action: 'heartbeat',
      payload: { agentId: this.agentId, status: snapshot.status, metrics: snapshot.metrics },
    })
  }
}

/** Start an observer; the only nanobot application command is `attach`. */
export async function startBridge(config, { warn = console.warn } = {}) {
  const monitor = new NanobotMonitor(config.chatIds)
  const client = new MissionControlClient(config)
  await client.register()
  let socket
  let reconnectTimer
  let stopped = false
  let dirty = true
  let lastPublished = 0
  let pending
  let alive = true

  const publish = () => {
    if (pending || (!dirty && Date.now() - lastPublished < 30_000)) return pending
    dirty = false
    pending = client.publish(monitor.snapshot()).then(() => {
      lastPublished = Date.now()
    }).catch(() => {
      dirty = true
      warn('nanobot bridge: status delivery failed; retrying on next heartbeat')
    }).finally(() => { pending = undefined })
    return pending
  }

  const connect = () => {
    if (stopped) return
    socket = new WebSocket(config.wsUrl, { handshakeTimeout: 10_000, maxPayload: 1024 * 1024 })
    socket.on('open', () => {
      alive = true
      monitor.connect()
      dirty = true
      for (const chat_id of config.chatIds) socket.send(JSON.stringify({ type: 'attach', chat_id }))
    })
    socket.on('message', raw => {
      try {
        const frame = JSON.parse(raw.toString())
        if (frame?.event === 'error') {
          warn('nanobot bridge: gateway rejected a command; check configured chat IDs and protocol version')
          return
        }
        dirty = monitor.accept(frame) || dirty
      } catch { /* Ignore malformed frames; do not print their contents. */ }
    })
    socket.on('pong', () => { alive = true })
    socket.on('error', () => { /* close performs the reconnect; never log credential-bearing errors. */ })
    socket.on('close', () => {
      monitor.disconnect()
      dirty = true
      if (!stopped) reconnectTimer = setTimeout(connect, 5000)
    })
  }

  await publish()
  connect()
  // Coalesce state bursts, bound in-flight delivery, and retry the latest
  // snapshot rather than accumulating an unbounded event queue.
  // At most 20 updates/minute, below the adapter's 30/minute limit.
  const deliveryTimer = setInterval(publish, 3000)
  const pingTimer = setInterval(() => {
    if (socket?.readyState !== WebSocket.OPEN) return
    if (!alive) return socket.terminate()
    alive = false
    socket.ping()
  }, 15_000)

  return async () => {
    stopped = true
    clearTimeout(reconnectTimer)
    clearInterval(deliveryTimer)
    clearInterval(pingTimer)
    socket?.terminate()
    await pending
    monitor.disconnect()
    dirty = true
    await publish()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const stop = await startBridge(readConfig())
    console.log('nanobot bridge: observing configured chats (Ctrl-C to stop)')
    let stopping = false
    const shutdown = async () => {
      if (stopping) return
      stopping = true
      await stop()
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  } catch {
    console.error('nanobot bridge: startup failed; check configuration, credentials and Mission Control availability')
    process.exitCode = 1
  }
}
