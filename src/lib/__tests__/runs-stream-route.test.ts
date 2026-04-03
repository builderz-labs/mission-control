import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn(() => ({ user: { id: 1, username: 'viewer', workspace_id: 1, role: 'viewer' } }))
const loggerMock = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
const eventBusOnMock = vi.fn()
const eventBusOffMock = vi.fn()

let serverEventHandler: ((event: { type: string; data: unknown; timestamp: number }) => void) | null = null

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/logger', () => ({ logger: loggerMock }))
vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    on: vi.fn((event: string, handler: (event: { type: string; data: unknown; timestamp: number }) => void) => {
      eventBusOnMock(event, handler)
      if (event === 'server-event') {
        serverEventHandler = handler
      }
    }),
    off: vi.fn((event: string, handler: (event: { type: string; data: unknown; timestamp: number }) => void) => {
      eventBusOffMock(event, handler)
      if (event === 'server-event' && serverEventHandler === handler) {
        serverEventHandler = null
      }
    }),
  },
}))

describe('GET /api/v1/runs/stream', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    serverEventHandler = null
  })

  it('streams run.created, run.updated, and run.eval_attached events', async () => {
    const { GET } = await import('@/app/api/v1/runs/stream/route')
    const request = new NextRequest('http://localhost/api/v1/runs/stream', {
      method: 'GET',
      headers: { 'user-agent': 'vitest' },
    })

    const response = await GET(request)
    const reader = response.body!.getReader()

    expect(serverEventHandler).toBeTypeOf('function')

    serverEventHandler!({
      type: 'run.created',
      data: {
        id: 'run-created-1',
        status: 'running',
      },
      timestamp: Date.now(),
    })

    let chunk = new TextDecoder().decode((await reader.read()).value)
    expect(chunk).toContain('event: run.created')
    expect(chunk).toContain('"id":"run-created-1"')

    serverEventHandler!({
      type: 'run.updated',
      data: {
        run_id: 'run-updated-1',
        progress: 50,
        source: 'openclaw',
      },
      timestamp: Date.now(),
    })

    chunk = new TextDecoder().decode((await reader.read()).value)
    expect(chunk).toContain('event: run.updated')
    expect(chunk).toContain('"run_id":"run-updated-1"')
    expect(chunk).toContain('"progress":50')

    serverEventHandler!({
      type: 'run.eval_attached',
      data: {
        id: 'run-eval-1',
        eval_pass: true,
        eval_score: 1,
      },
      timestamp: Date.now(),
    })

    chunk = new TextDecoder().decode((await reader.read()).value)
    expect(chunk).toContain('event: run.eval_attached')
    expect(chunk).toContain('"id":"run-eval-1"')
    expect(chunk).toContain('"eval_pass":true')
  })

  it('streams OpenClaw run.completed events', async () => {
    const { GET } = await import('@/app/api/v1/runs/stream/route')
    const request = new NextRequest('http://localhost/api/v1/runs/stream', {
      method: 'GET',
      headers: { 'user-agent': 'vitest' },
    })

    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    expect(eventBusOnMock).toHaveBeenCalledWith('server-event', expect.any(Function))
    expect(serverEventHandler).toBeTypeOf('function')

    serverEventHandler!({
      type: 'run.completed',
      data: {
        run_id: 'run-abc-123',
        status: 'completed',
        outcome: 'success',
        runtime_session_id: 'session-1',
        runtime_node_id: 'node-a',
        source: 'openclaw',
      },
      timestamp: Date.now(),
    })

    const reader = response.body!.getReader()
    const { value, done } = await reader.read()
    const chunk = new TextDecoder().decode(value)

    expect(done).toBe(false)
    expect(chunk).toContain('event: run.completed')
    expect(chunk).toContain('"run_id":"run-abc-123"')
    expect(chunk).toContain('"runtime_session_id":"session-1"')
    expect(chunk).toContain('"runtime_node_id":"node-a"')
    expect(chunk).toContain('"source":"openclaw"')
  })

  it('ignores non-run events', async () => {
    const { GET } = await import('@/app/api/v1/runs/stream/route')
    const request = new NextRequest('http://localhost/api/v1/runs/stream', {
      method: 'GET',
      headers: { 'user-agent': 'vitest' },
    })

    const response = await GET(request)

    expect(serverEventHandler).toBeTypeOf('function')

    serverEventHandler!({
      type: 'task.updated',
      data: { id: 7, status: 'review' },
      timestamp: Date.now(),
    })

    let resolved = false
    const readPromise = response.body!.getReader().read().then(() => {
      resolved = true
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(resolved).toBe(false)
    readPromise.catch(() => {})
  })
})
