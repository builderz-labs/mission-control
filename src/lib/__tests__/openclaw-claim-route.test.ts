import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn(() => ({ user: { id: 5, username: 'operator', workspace_id: 1, role: 'operator' } }))
const mutationLimiterMock = vi.fn(() => null)
const getDatabaseMock = vi.fn(() => ({ fake: true }))
const claimDispatchMock = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: mutationLimiterMock }))
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
    claimDispatch: claimDispatchMock,
    OpenClawRuntimeError,
  }
})

describe('POST /api/runtime/openclaw/dispatches/[dispatchId]/claim', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns 201 for successful claim', async () => {
    claimDispatchMock.mockReturnValue({ dispatch_id: 7, task_id: 7, dispatch_status: 'acked', acked_at: 123, snapshot_hash: 'hash', run_id: 'run-abc-123' })

    const { POST } = await import('@/app/api/runtime/openclaw/dispatches/[dispatchId]/claim/route')
    const request = new NextRequest('http://localhost/api/runtime/openclaw/dispatches/7/claim', {
      method: 'POST',
      body: JSON.stringify({
        agent_id: 'openclaw-node-01',
        runtime_node_id: 'node-a',
        runtime_session_id: 'session-1',
        capability_tags: ['builder'],
      }),
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    })

    const response = await POST(request, { params: Promise.resolve({ dispatchId: '7' }) })
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload.ok).toBe(true)
    expect(claimDispatchMock).toHaveBeenCalledWith(
      { fake: true },
      expect.objectContaining({ dispatchId: 7, agentId: 'openclaw-node-01', runtimeSessionId: 'session-1' }),
    )
  })

  it('returns 400 for invalid request body', async () => {
    const { POST } = await import('@/app/api/runtime/openclaw/dispatches/[dispatchId]/claim/route')
    const request = new NextRequest('http://localhost/api/runtime/openclaw/dispatches/7/claim', {
      method: 'POST',
      body: JSON.stringify({ runtime_node_id: 'node-a', runtime_session_id: 'session-1' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ dispatchId: '7' }) })
    expect(response.status).toBe(400)
  })

  it('maps runtime conflicts to status code', async () => {
    const { OpenClawRuntimeError } = await import('@/lib/openclaw-runtime')
    claimDispatchMock.mockImplementation(() => {
      throw new OpenClawRuntimeError('DISPATCH_ALREADY_CLAIMED', 'claimed', 409)
    })

    const { POST } = await import('@/app/api/runtime/openclaw/dispatches/[dispatchId]/claim/route')
    const request = new NextRequest('http://localhost/api/runtime/openclaw/dispatches/7/claim', {
      method: 'POST',
      body: JSON.stringify({
        agent_id: 'openclaw-node-01',
        runtime_node_id: 'node-a',
        runtime_session_id: 'session-1',
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ dispatchId: '7' }) })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error.code).toBe('DISPATCH_ALREADY_CLAIMED')
  })
})
