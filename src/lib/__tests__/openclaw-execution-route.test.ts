import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn(() => ({ user: { id: 5, username: 'operator', workspace_id: 1, role: 'operator' } }))
const getDatabaseMock = vi.fn(() => ({ fake: true }))
const getExecutionStatusMock = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
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
    getExecutionStatus: getExecutionStatusMock,
    OpenClawRuntimeError,
  }
})

describe('GET /api/runtime/executions/[runId]', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns 200 with execution status', async () => {
    getExecutionStatusMock.mockReturnValue({
      run_id: 'run-abc-123',
      status: 'running',
      outcome: null,
      progress: 55,
      progress_message: 'Halfway done',
      error: null,
      started_at: '2024-01-01T00:00:00Z',
      ended_at: null,
      metadata: { openclaw: { runtime_session_id: 'session-1' } },
      runtime_session_id: 'session-1',
    })

    const { GET } = await import('@/app/api/runtime/executions/[runId]/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-abc-123?runtime_session_id=session-1', {
      method: 'GET',
      headers: { 'user-agent': 'vitest' },
    })

    const response = await GET(request, { params: Promise.resolve({ runId: 'run-abc-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.data.run_id).toBe('run-abc-123')
    expect(payload.data.status).toBe('running')
    expect(payload.data.progress).toBe(55)
    expect(getExecutionStatusMock).toHaveBeenCalledWith(
      { fake: true },
      expect.objectContaining({ runId: 'run-abc-123', runtimeSessionId: 'session-1' }),
    )
  })

  it('returns 400 for invalid run ID', async () => {
    const { GET } = await import('@/app/api/runtime/executions/[runId]/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/   ', {
      method: 'GET',
      headers: { 'user-agent': 'vitest' },
    })

    const response = await GET(request, { params: Promise.resolve({ runId: '   ' }) })
    expect(response.status).toBe(400)
  })

  it('returns 404 when run not found', async () => {
    const { OpenClawRuntimeError } = await import('@/lib/openclaw-runtime')
    getExecutionStatusMock.mockImplementation(() => {
      throw new OpenClawRuntimeError('RUN_NOT_FOUND', 'Run not found', 404)
    })

    const { GET } = await import('@/app/api/runtime/executions/[runId]/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/missing-run', {
      method: 'GET',
      headers: { 'user-agent': 'vitest' },
    })

    const response = await GET(request, { params: Promise.resolve({ runId: 'missing-run' }) })
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error.code).toBe('RUN_NOT_FOUND')
  })

  it('returns 403 when runtime session mismatch', async () => {
    const { OpenClawRuntimeError } = await import('@/lib/openclaw-runtime')
    getExecutionStatusMock.mockImplementation(() => {
      throw new OpenClawRuntimeError('RUN_NOT_OWNED_BY_AGENT', 'Run belongs to a different runtime session', 403)
    })

    const { GET } = await import('@/app/api/runtime/executions/[runId]/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-abc-123?runtime_session_id=wrong-session', {
      method: 'GET',
      headers: { 'user-agent': 'vitest' },
    })

    const response = await GET(request, { params: Promise.resolve({ runId: 'run-abc-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error.code).toBe('RUN_NOT_OWNED_BY_AGENT')
  })

  it('works without runtime_session_id query param', async () => {
    getExecutionStatusMock.mockReturnValue({
      run_id: 'run-abc-123',
      status: 'completed',
      outcome: 'success',
      progress: 100,
      progress_message: null,
      error: null,
      started_at: '2024-01-01T00:00:00Z',
      ended_at: '2024-01-01T01:00:00Z',
      metadata: {},
      runtime_session_id: null,
    })

    const { GET } = await import('@/app/api/runtime/executions/[runId]/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-abc-123', {
      method: 'GET',
      headers: { 'user-agent': 'vitest' },
    })

    const response = await GET(request, { params: Promise.resolve({ runId: 'run-abc-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.data.run_id).toBe('run-abc-123')
    expect(getExecutionStatusMock).toHaveBeenCalledWith(
      { fake: true },
      expect.objectContaining({ runId: 'run-abc-123', runtimeSessionId: undefined }),
    )
  })
})
