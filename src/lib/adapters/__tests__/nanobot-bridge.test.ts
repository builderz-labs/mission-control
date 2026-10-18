// @vitest-environment node
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { MissionControlClient, NanobotMonitor, readConfig, startBridge } from '../../../../scripts/nanobot-bridge.mjs'

const event = (event: string, fields = {}) => ({ event, chat_id: 'chat-a', ...fields })
const config = () => readConfig({
  MC_API_KEY: 'test-mc-key', NANOBOT_TOKEN: 'test-nanobot-key', NANOBOT_CHAT_IDS: 'chat-a,chat-b',
})

describe('nanobot state projection', () => {
  it('starts unknown and resets evidence across reconnects', () => {
    const monitor = new NanobotMonitor(['chat-a'])
    expect(monitor.snapshot().status).toBe('offline')
    monitor.connect()
    expect(monitor.snapshot().metrics.sessions.unknown).toBe(1)
    monitor.accept(event('goal_status', { status: 'running', turn_id: 'turn-1' }))
    expect(monitor.snapshot().status).toBe('busy')
    monitor.disconnect()
    expect(monitor.snapshot().status).toBe('offline')
    expect(monitor.accept(event('turn_end'))).toBe(false)
    monitor.connect()
    expect(monitor.snapshot().metrics.sessions.unknown).toBe(1)
  })

  it('ignores unselected chats, malformed input and content events', () => {
    const monitor = new NanobotMonitor(['chat-a'])
    monitor.connect()
    for (const frame of [null, 'text', {}, event('delta', { content: 'private' }),
      event('goal_status', { chat_id: 'other', status: 'running' })]) {
      expect(monitor.accept(frame)).toBe(false)
    }
    expect(JSON.stringify(monitor.snapshot())).not.toContain('private')
  })

  it('does not treat turn completion as business-task completion', () => {
    const monitor = new NanobotMonitor(['chat-a'])
    monitor.connect()
    monitor.accept(event('goal_status', { status: 'running' }))
    monitor.accept(event('turn_end', { content: 'private answer', goal_state: { active: false } }))
    expect(monitor.snapshot().status).toBe('idle')
    expect(monitor.snapshot().metrics.sessions.idle).toBe(1)
    expect(JSON.stringify(monitor.snapshot())).not.toMatch(/private|completed|done/)
  })

  it('rejects ending events for a previous turn', () => {
    const monitor = new NanobotMonitor(['chat-a'])
    monitor.connect()
    monitor.accept(event('goal_status', { status: 'running', turn_id: 'new' }))
    monitor.accept(event('turn_end', { turn_id: 'old' }))
    monitor.accept(event('goal_status', { status: 'idle', turn_id: 'old' }))
    expect(monitor.snapshot().status).toBe('busy')
  })

  it('retains awaiting-user and failure evidence after idle notifications', () => {
    const monitor = new NanobotMonitor(['chat-a'])
    monitor.connect()
    monitor.accept(event('attached', { recovery_state: { status: 'awaiting_user', reason: 'private' } }))
    monitor.accept(event('goal_status', { status: 'idle' }))
    expect(monitor.snapshot().metrics.sessions.awaiting_user).toBe(1)
    monitor.accept(event('recovery_state', { status: 'failed' }))
    monitor.accept(event('goal_status', { status: 'idle' }))
    expect(monitor.snapshot().status).toBe('error')
    monitor.accept(event('goal_status', { status: 'running', turn_id: 'next' }))
    expect(monitor.snapshot().status).toBe('busy')
    expect(JSON.stringify(monitor.snapshot())).not.toContain('private')
  })

  it('maps retries, recovery, blocked goals and failed turns without percentages', () => {
    const monitor = new NanobotMonitor(['chat-a'])
    monitor.connect()
    monitor.accept(event('retry_status', { state: 'waiting' }))
    expect(monitor.snapshot().status).toBe('busy')
    monitor.accept(event('retry_status', { state: 'recovered' }))
    expect(monitor.snapshot().metrics.sessions.running).toBe(1)
    monitor.accept(event('turn_end', { outcome: 'failed', failure_message: 'secret' }))
    expect(monitor.snapshot().status).toBe('error')
    monitor.accept(event('turn_end', { outcome: 'unknown-future-outcome' }))
    expect(monitor.snapshot().status).toBe('error')
    monitor.accept(event('goal_status', { status: 'running' }))
    monitor.accept(event('turn_end', { outcome: 'error', failure_kind: 'provider_error' }))
    expect(monitor.snapshot().status).toBe('error')
    monitor.accept(event('recovery_state', { status: 'resuming' }))
    monitor.accept(event('turn_end', { goal_state: { status: 'blocked', objective: 'secret' } }))
    expect(monitor.snapshot().metrics.sessions.awaiting_user).toBe(1)
    expect(JSON.stringify(monitor.snapshot())).not.toContain('secret')
    expect(monitor.snapshot()).not.toHaveProperty('progress')
  })

  it('aggregates concurrently running chats without losing waiting counts', () => {
    const monitor = new NanobotMonitor(['chat-a', 'chat-b'])
    monitor.connect()
    monitor.accept(event('recovery_state', { status: 'awaiting_user' }))
    monitor.accept(event('goal_status', { chat_id: 'chat-b', status: 'running' }))
    expect(monitor.snapshot().status).toBe('busy')
    expect(monitor.snapshot().metrics.sessions.awaiting_user).toBe(1)
    monitor.accept(event('turn_end', { chat_id: 'chat-b', outcome: 'cancelled' }))
    expect(monitor.snapshot().metrics.sessions.unknown).toBe(1)
  })
})

describe('nanobot bridge configuration and HTTP contract', () => {
  it('validates explicit allowlists and keeps credentials out of URL input', () => {
    expect(() => readConfig({ MC_API_KEY: 'key' })).toThrow('NANOBOT_CHAT_IDS')
    expect(() => readConfig({ MC_API_KEY: 'key', NANOBOT_CHAT_IDS: '../private' })).toThrow('NANOBOT_CHAT_IDS')
    expect(() => readConfig({ MC_API_KEY: 'key', NANOBOT_CHAT_IDS: 'ok', NANOBOT_WS_URL: 'ws://localhost/?token=secret' })).toThrow('credentials')
    expect(config().wsUrl.searchParams.get('token')).toBe('test-nanobot-key')
  })

  it('uses persisted agent ID, existing scoped endpoints and a content-free heartbeat', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ agent: { id: 12 } }) })
    const client = new MissionControlClient(config(), fetcher)
    await client.register()
    const monitor = new NanobotMonitor(['chat-a'])
    await client.publish(monitor.snapshot())
    const calls = fetcher.mock.calls.map(([url, options]) => ({ url, ...options, body: JSON.parse(options.body) }))
    expect(calls.map(call => call.url)).toEqual([
      'http://127.0.0.1:3000/api/agents/register', 'http://127.0.0.1:3000/api/agents', 'http://127.0.0.1:3000/api/adapters',
    ])
    expect(calls[1].method).toBe('PUT')
    expect(calls[2].body.payload.agentId).toBe('12')
    expect(calls[2].body.framework).toBe('nanobot')
    expect(calls.every(call => call.redirect === 'error')).toBe(true)
    expect(calls.every(call => call.headers['x-api-key'] === 'test-mc-key')).toBe(true)
    expect(JSON.stringify(calls)).not.toContain('test-nanobot-key')
  })

  it('rejects failed registration and missing IDs before publishing', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 401 })
    const client = new MissionControlClient(config(), fetcher)
    await expect(client.register()).rejects.toThrow('HTTP 401')
    await expect(client.publish(new NanobotMonitor(['chat-a']).snapshot())).rejects.toThrow('Register')
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ agent: {} }) })
    await expect(client.register()).rejects.toThrow('invalid agent ID')
  })
})

describe('nanobot bridge over local HTTP and WebSocket', () => {
  const cleanup: Array<() => Promise<unknown>> = []
  afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) await close()
  })

  it('only attaches, delivers states, reconnects and marks shutdown offline', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    let rejectFirstUpdate = true
    const warn = vi.fn()
    const http = createServer(async (req, res) => {
      let raw = ''
      for await (const chunk of req) raw += chunk
      expect(req.headers['x-api-key']).toBe('test-mc-key')
      requests.push({ url: req.url!, body: JSON.parse(raw) })
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/agents' && rejectFirstUpdate) {
        rejectFirstUpdate = false
        res.statusCode = 503
        res.end(JSON.stringify({ error: 'private upstream details' }))
        return
      }
      res.end(JSON.stringify(req.url === '/api/agents/register' ? { agent: { id: 7 } } : { ok: true }))
    })
    http.listen(0, '127.0.0.1')
    await once(http, 'listening')
    cleanup.push(() => new Promise<void>(resolve => http.close(() => resolve())))
    const ws = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    await once(ws, 'listening')
    cleanup.push(() => {
      for (const client of ws.clients) client.terminate()
      return new Promise<void>(resolve => ws.close(() => resolve()))
    })
    const commands: unknown[] = []
    let connections = 0
    ws.on('connection', (socket, req) => {
      connections++
      expect(new URL(req.url!, 'http://local').searchParams.get('token')).toBe('test-nanobot-key')
      socket.on('message', raw => {
        commands.push(JSON.parse(raw.toString()))
        socket.send(JSON.stringify(event('goal_status', { status: 'running', turn_id: 'run' })))
        socket.send(JSON.stringify(event('delta', { content: 'private conversation' })))
      })
    })
    const settings = config()
    settings.mcUrl = new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}`)
    settings.wsUrl = new URL(`ws://127.0.0.1:${(ws.address() as AddressInfo).port}/?token=test-nanobot-key`)
    const stop = await startBridge(settings, { warn })
    cleanup.push(stop)
    await vi.waitFor(() => expect(requests.some(req => req.body.status === 'busy')).toBe(true), { timeout: 4000 })
    for (const client of ws.clients) client.terminate()
    await vi.waitFor(() => expect(connections).toBe(2), { timeout: 8000 })
    await vi.waitFor(() => expect(commands).toHaveLength(4))
    expect(commands).toEqual([
      { type: 'attach', chat_id: 'chat-a' }, { type: 'attach', chat_id: 'chat-b' },
      { type: 'attach', chat_id: 'chat-a' }, { type: 'attach', chat_id: 'chat-b' },
    ])
    await stop()
    cleanup.pop()
    expect(requests.filter(req => req.url === '/api/agents').at(-1)?.body.status).toBe('offline')
    expect(JSON.stringify(requests)).not.toContain('private conversation')
    expect(warn).toHaveBeenCalledWith('nanobot bridge: status delivery failed; retrying on next heartbeat')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private upstream details')
    expect(requests.every(req => !req.url.startsWith('/api/tasks'))).toBe(true)
  }, 15_000)
})
