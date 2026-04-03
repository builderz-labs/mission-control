import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn(() => ({ user: { id: 5, username: 'operator', workspace_id: 1, role: 'operator' } }))
const agentHeartbeatLimiterMock = vi.fn(() => null)
const getDatabaseMock = vi.fn(() => ({ fake: true }))
const recordOpenClawHeartbeatMock = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/rate-limit', () => ({ agentHeartbeatLimiter: agentHeartbeatLimiterMock }))
vi.mock('@/lib/db', () => ({ getDatabase: getDatabaseMock }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/openclaw-runtime', () => {
  class OpenClawRuntimeError extends Error {
    code: string
    status: number
    constructor(code: string, message: string, status: number) {
      super(message)
      this.code = code
      this.status = status
    }
  }

  return {
    recordOpenClawHeartbeat: recordOpenClawHeartbeatMock,
    OpenClawRuntimeError,
  }
})

describe('POST /api/runtime/openclaw/heartbeat', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns 200 for successful heartbeat', async () => {
    recordOpenClawHeartbeatMock.mockReturnValue({ accepted: true, server_time: 123 })

    const { POST } = await import('@/app/api/runtime/openclaw/heartbeat/route')
    const request = new NextRequest('http://localhost/api/runtime/openclaw/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        agent_id: 'openclaw-node-01',
        runtime_type: 'openclaw',
        runtime_node_id: 'node-a',
        runtime_session_id: 'session-1',
        node_status: 'busy',
        current_load: 2,
        max_concurrency: 4,
        queue_lag: 0,
        capability_tags: ['builder'],
        metadata: { region: 'us-east-1' },
      }),
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(recordOpenClawHeartbeatMock).toHaveBeenCalledWith(
      { fake: true },
      expect.objectContaining({
        agentId: 'openclaw-node-01',
        runtimeType: 'openclaw',
        runtimeNodeId: 'node-a',
        runtimeSessionId: 'session-1',
        nodeStatus: 'busy',
      }),
    )
  })

  it('returns 400 for invalid request body', async () => {
    const { POST } = await import('@/app/api/runtime/openclaw/heartbeat/route')
    const request = new NextRequest('http://localhost/api/runtime/openclaw/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ runtime_node_id: 'node-a', runtime_session_id: 'session-1' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('maps runtime errors to status code', async () => {
    const { OpenClawRuntimeError } = await import('@/lib/openclaw-runtime')
    recordOpenClawHeartbeatMock.mockImplementation(() => {
      throw new OpenClawRuntimeError('AGENT_NOT_FOUND', 'missing', 404)
    })

    const { POST } = await import('@/app/api/runtime/openclaw/heartbeat/route')
    const request = new NextRequest('http://localhost/api/runtime/openclaw/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        agent_id: 'missing-node',
        runtime_node_id: 'node-a',
        runtime_session_id: 'session-1',
        node_status: 'online',
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error.code).toBe('AGENT_NOT_FOUND')
  })
})
