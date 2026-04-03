import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn(() => ({ user: { id: 5, username: 'operator', workspace_id: 1, role: 'operator' } }))
const mutationLimiterMock = vi.fn(() => null)
const getDatabaseMock = vi.fn(() => ({ fake: true }))
const recordExecutionProgressMock = vi.fn()

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
    recordExecutionProgress: recordExecutionProgressMock,
    OpenClawRuntimeError,
  }
})

describe('POST /api/runtime/executions/[runId]/progress', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns 200 for successful progress update', async () => {
    recordExecutionProgressMock.mockReturnValue({
      run_id: 'run-123',
      progress: 60,
      message: 'Processing step 3 of 5',
      metrics: { tool_calls: 12 },
      runtime_node_id: 'node-a',
      runtime_session_id: 'session-1',
      updated_at: '2026-04-03T10:00:00Z',
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/progress/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/progress', {
      method: 'POST',
      body: JSON.stringify({
        progress: 60,
        message: 'Processing step 3 of 5',
        metrics: { tool_calls: 12 },
        runtime_node_id: 'node-a',
        runtime_session_id: 'session-1',
      }),
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.data.run_id).toBe('run-123')
    expect(payload.data.progress).toBe(60)
    expect(recordExecutionProgressMock).toHaveBeenCalledWith(
      { fake: true },
      expect.objectContaining({ runId: 'run-123', progress: 60, message: 'Processing step 3 of 5' }),
    )
  })

  it('returns 400 for invalid request body', async () => {
    const { POST } = await import('@/app/api/runtime/executions/[runId]/progress/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/progress', {
      method: 'POST',
      body: JSON.stringify({ progress: 150 }), // Invalid: > 100
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    expect(response.status).toBe(400)
  })

  it('returns 404 when run not found', async () => {
    const { OpenClawRuntimeError } = await import('@/lib/openclaw-runtime')
    recordExecutionProgressMock.mockImplementation(() => {
      throw new OpenClawRuntimeError('RUN_NOT_FOUND', 'Run not found', 404)
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/progress/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/progress', {
      method: 'POST',
      body: JSON.stringify({ progress: 50 }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error.code).toBe('RUN_NOT_FOUND')
  })

  it('returns 403 when run owned by different session', async () => {
    const { OpenClawRuntimeError } = await import('@/lib/openclaw-runtime')
    recordExecutionProgressMock.mockImplementation(() => {
      throw new OpenClawRuntimeError('RUN_NOT_OWNED_BY_AGENT', 'Run belongs to a different runtime session', 403)
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/progress/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/progress', {
      method: 'POST',
      body: JSON.stringify({ progress: 50, runtime_session_id: 'different-session' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error.code).toBe('RUN_NOT_OWNED_BY_AGENT')
  })

  it('accepts minimal valid request with only progress', async () => {
    recordExecutionProgressMock.mockReturnValue({
      run_id: 'run-123',
      progress: 75,
      message: null,
      metrics: {},
      runtime_node_id: null,
      runtime_session_id: null,
      updated_at: '2026-04-03T10:00:00Z',
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/progress/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/progress', {
      method: 'POST',
      body: JSON.stringify({ progress: 75 }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.data.progress).toBe(75)
  })
})
