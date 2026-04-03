import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn(() => ({ user: { id: 5, username: 'operator', workspace_id: 1, role: 'operator' } }))
const mutationLimiterMock = vi.fn(() => null)
const getDatabaseMock = vi.fn(() => ({ fake: true }))
const cancelExecutionMock = vi.fn()

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
    cancelExecution: cancelExecutionMock,
    OpenClawRuntimeError,
  }
})

describe('POST /api/runtime/executions/[runId]/cancel', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns 200 for successful cancellation with reason', async () => {
    cancelExecutionMock.mockReturnValue({
      run_id: 'run-123',
      status: 'cancelled',
      outcome: 'cancelled',
      cancelled_at: 1743686400,
      reason: 'User requested cancellation',
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/cancel/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/cancel', {
      method: 'POST',
      body: JSON.stringify({
        reason: 'User requested cancellation',
        runtime_session_id: 'session-1',
      }),
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.data.run_id).toBe('run-123')
    expect(payload.data.status).toBe('cancelled')
    expect(payload.data.reason).toBe('User requested cancellation')
    expect(cancelExecutionMock).toHaveBeenCalledWith(
      { fake: true },
      expect.objectContaining({
        runId: 'run-123',
        reason: 'User requested cancellation',
        runtimeSessionId: 'session-1',
      }),
    )
  })

  it('returns 200 for successful cancellation without reason', async () => {
    cancelExecutionMock.mockReturnValue({
      run_id: 'run-123',
      status: 'cancelled',
      outcome: 'cancelled',
      cancelled_at: 1743686400,
      reason: null,
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/cancel/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/cancel', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.data.status).toBe('cancelled')
    expect(payload.data.reason).toBeNull()
  })

  it('accepts cancellation with empty body', async () => {
    cancelExecutionMock.mockReturnValue({
      run_id: 'run-123',
      status: 'cancelled',
      outcome: 'cancelled',
      cancelled_at: 1743686400,
      reason: null,
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/cancel/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/cancel', {
      method: 'POST',
      body: '',
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    expect(response.status).toBe(200)
  })

  it('returns 400 for invalid reason type', async () => {
    const { POST } = await import('@/app/api/runtime/executions/[runId]/cancel/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/cancel', {
      method: 'POST',
      body: JSON.stringify({
        reason: 123, // Should be string
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    expect(response.status).toBe(400)
  })

  it('returns 404 when run not found', async () => {
    const { OpenClawRuntimeError } = await import('@/lib/openclaw-runtime')
    cancelExecutionMock.mockImplementation(() => {
      throw new OpenClawRuntimeError('RUN_NOT_FOUND', 'Run not found', 404)
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/cancel/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/cancel', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error.code).toBe('RUN_NOT_FOUND')
  })

  it('returns 409 when run is already finalized', async () => {
    const { OpenClawRuntimeError } = await import('@/lib/openclaw-runtime')
    cancelExecutionMock.mockImplementation(() => {
      throw new OpenClawRuntimeError('RUN_ALREADY_FINALIZED', 'Run is already completed and cannot be cancelled', 409)
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/cancel/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/cancel', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Trying to cancel' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error.code).toBe('RUN_ALREADY_FINALIZED')
  })

  it('returns 403 when run owned by different session', async () => {
    const { OpenClawRuntimeError } = await import('@/lib/openclaw-runtime')
    cancelExecutionMock.mockImplementation(() => {
      throw new OpenClawRuntimeError('RUN_NOT_OWNED_BY_AGENT', 'Run belongs to a different runtime session', 403)
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/cancel/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/cancel', {
      method: 'POST',
      body: JSON.stringify({
        reason: 'Cancel this',
        runtime_session_id: 'different-session',
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error.code).toBe('RUN_NOT_OWNED_BY_AGENT')
  })

  it('handles long reason strings up to 1000 characters', async () => {
    cancelExecutionMock.mockReturnValue({
      run_id: 'run-123',
      status: 'cancelled',
      outcome: 'cancelled',
      cancelled_at: 1743686400,
      reason: 'a'.repeat(1000),
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/cancel/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/cancel', {
      method: 'POST',
      body: JSON.stringify({
        reason: 'a'.repeat(1000),
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    expect(response.status).toBe(200)
  })

  it('rejects reason strings longer than 1000 characters', async () => {
    const { POST } = await import('@/app/api/runtime/executions/[runId]/cancel/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/cancel', {
      method: 'POST',
      body: JSON.stringify({
        reason: 'a'.repeat(1001),
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    expect(response.status).toBe(400)
  })

  it('passes correct IP and user agent to service', async () => {
    cancelExecutionMock.mockReturnValue({
      run_id: 'run-123',
      status: 'cancelled',
      outcome: 'cancelled',
      cancelled_at: 1743686400,
      reason: null,
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/cancel/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/cancel', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '192.168.1.1',
        'user-agent': 'OpenClaw-Runtime/1.0',
      },
    })

    await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })

    expect(cancelExecutionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ipAddress: '192.168.1.1',
        userAgent: 'OpenClaw-Runtime/1.0',
      }),
    )
  })
})
