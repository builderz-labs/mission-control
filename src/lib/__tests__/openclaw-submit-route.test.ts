import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn(() => ({ user: { id: 5, username: 'operator', workspace_id: 1, role: 'operator' } }))
const mutationLimiterMock = vi.fn(() => null)
const getDatabaseMock = vi.fn(() => ({ fake: true }))
const submitExecutionResultMock = vi.fn()

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
    submitExecutionResult: submitExecutionResultMock,
    OpenClawRuntimeError,
  }
})

describe('POST /api/runtime/executions/[runId]/submit', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns 200 for successful submission with completed status', async () => {
    submitExecutionResultMock.mockReturnValue({
      run_id: 'run-123',
      status: 'completed',
      outcome: 'success',
      submitted_at: 1743686400,
      artifacts_count: 2,
      logs_count: 5,
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        outcome: 'success',
        result: { output: 'Task completed successfully' },
        artifacts: [
          { type: 'file', name: 'output.txt', path: '/tmp/output.txt' },
          { type: 'image', name: 'screenshot.png', path: '/tmp/screenshot.png' },
        ],
        logs: [
          { level: 'info', message: 'Starting task' },
          { level: 'info', message: 'Task completed' },
        ],
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
    expect(payload.data.status).toBe('completed')
    expect(payload.data.artifacts_count).toBe(2)
    expect(payload.data.logs_count).toBe(5)
    expect(submitExecutionResultMock).toHaveBeenCalledWith(
      { fake: true },
      expect.objectContaining({
        runId: 'run-123',
        status: 'completed',
        outcome: 'success',
        artifacts: expect.arrayContaining([
          expect.objectContaining({ type: 'file', name: 'output.txt' }),
        ]),
      }),
    )
  })

  it('returns 200 for successful submission with failed status', async () => {
    submitExecutionResultMock.mockReturnValue({
      run_id: 'run-123',
      status: 'failed',
      outcome: 'error',
      submitted_at: 1743686400,
      artifacts_count: 0,
      logs_count: 3,
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'failed',
        outcome: 'error',
        error: 'Task failed due to timeout',
        logs: [
          { level: 'error', message: 'Connection timeout' },
          { level: 'warn', message: 'Retrying...' },
        ],
        runtime_node_id: 'node-a',
        runtime_session_id: 'session-1',
      }),
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.data.status).toBe('failed')
    expect(payload.data.outcome).toBe('error')
  })

  it('returns 200 for successful submission with cancelled status', async () => {
    submitExecutionResultMock.mockReturnValue({
      run_id: 'run-123',
      status: 'cancelled',
      outcome: 'cancelled',
      submitted_at: 1743686400,
      artifacts_count: 0,
      logs_count: 1,
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'cancelled',
        outcome: 'cancelled',
        logs: [{ level: 'info', message: 'Task cancelled by user' }],
      }),
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.data.status).toBe('cancelled')
  })

  it('returns 400 for invalid status', async () => {
    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'invalid-status',
        outcome: 'success',
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    expect(response.status).toBe(400)
  })

  it('returns 400 for invalid outcome', async () => {
    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        outcome: 'invalid-outcome',
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    expect(response.status).toBe(400)
  })

  it('returns 400 for invalid artifact type', async () => {
    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        artifacts: [{ type: '', name: 'test.txt' }],
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    expect(response.status).toBe(400)
  })

  it('returns 400 for invalid log level', async () => {
    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        logs: [{ level: 'invalid', message: 'test' }],
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    expect(response.status).toBe(400)
  })

  it('returns 404 when run not found', async () => {
    const { OpenClawRuntimeError } = await import('@/lib/openclaw-runtime')
    submitExecutionResultMock.mockImplementation(() => {
      throw new OpenClawRuntimeError('RUN_NOT_FOUND', 'Run not found', 404)
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        outcome: 'success',
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error.code).toBe('RUN_NOT_FOUND')
  })

  it('returns 403 when run owned by different session', async () => {
    const { OpenClawRuntimeError } = await import('@/lib/openclaw-runtime')
    submitExecutionResultMock.mockImplementation(() => {
      throw new OpenClawRuntimeError('RUN_NOT_OWNED_BY_AGENT', 'Run belongs to a different runtime session', 403)
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        outcome: 'success',
        runtime_session_id: 'different-session',
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error.code).toBe('RUN_NOT_OWNED_BY_AGENT')
  })

  it('accepts minimal valid request with only status', async () => {
    submitExecutionResultMock.mockReturnValue({
      run_id: 'run-123',
      status: 'completed',
      outcome: null,
      submitted_at: 1743686400,
      artifacts_count: 0,
      logs_count: 0,
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({ status: 'completed' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.data.status).toBe('completed')
  })

  it('handles artifacts with content and metadata', async () => {
    submitExecutionResultMock.mockReturnValue({
      run_id: 'run-123',
      status: 'completed',
      outcome: 'success',
      submitted_at: 1743686400,
      artifacts_count: 1,
      logs_count: 0,
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        outcome: 'success',
        artifacts: [
          {
            type: 'file',
            name: 'output.json',
            content: '{"result": "success"}',
            metadata: { size: 100, encoding: 'utf-8' },
          },
        ],
      }),
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })

    expect(response.status).toBe(200)
    expect(submitExecutionResultMock).toHaveBeenCalledWith(
      { fake: true },
      expect.objectContaining({
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            type: 'file',
            name: 'output.json',
            content: '{"result": "success"}',
            metadata: { size: 100, encoding: 'utf-8' },
          }),
        ]),
      }),
    )
  })

  it('handles logs with timestamps and metadata', async () => {
    submitExecutionResultMock.mockReturnValue({
      run_id: 'run-123',
      status: 'completed',
      outcome: 'success',
      submitted_at: 1743686400,
      artifacts_count: 0,
      logs_count: 2,
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        outcome: 'success',
        logs: [
          {
            level: 'info',
            message: 'Processing started',
            timestamp: 1743686300,
            metadata: { step: 1 },
          },
          {
            level: 'debug',
            message: 'Debug info',
            timestamp: 1743686350,
            metadata: { detail: 'value' },
          },
        ],
      }),
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })

    expect(response.status).toBe(200)
    expect(submitExecutionResultMock).toHaveBeenCalledWith(
      { fake: true },
      expect.objectContaining({
        logs: expect.arrayContaining([
          expect.objectContaining({
            level: 'info',
            message: 'Processing started',
            timestamp: 1743686300,
            metadata: { step: 1 },
          }),
        ]),
      }),
    )
  })

  it('rejects request with more than 100 artifacts', async () => {
    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const artifacts = Array.from({ length: 101 }, (_, i) => ({
      type: 'file',
      name: `file-${i}.txt`,
    }))

    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        artifacts,
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    expect(response.status).toBe(400)
  })

  it('rejects request with more than 1000 logs', async () => {
    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const logs = Array.from({ length: 1001 }, (_, i) => ({
      level: 'info',
      message: `Log message ${i}`,
    }))

    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        logs,
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    expect(response.status).toBe(400)
  })

  it('accepts auto_validate flag for successful execution', async () => {
    submitExecutionResultMock.mockReturnValue({
      run_id: 'run-123',
      status: 'completed',
      outcome: 'success',
      submitted_at: 1743686400,
      artifacts_count: 0,
      logs_count: 0,
      eval_result: { pass: true, score: 1.0, detail: 'Auto-validation passed' },
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        outcome: 'success',
        auto_validate: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(submitExecutionResultMock).toHaveBeenCalledWith(
      { fake: true },
      expect.objectContaining({
        runId: 'run-123',
        status: 'completed',
        outcome: 'success',
        auto_validate: true,
      }),
    )
  })

  it('accepts auto_validate flag for failed execution', async () => {
    submitExecutionResultMock.mockReturnValue({
      run_id: 'run-123',
      status: 'failed',
      outcome: 'error',
      submitted_at: 1743686400,
      artifacts_count: 0,
      logs_count: 1,
      eval_result: { pass: false, score: 0.0, detail: 'Auto-validation failed' },
    })

    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'failed',
        outcome: 'error',
        error: 'Task failed',
        auto_validate: true,
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.data.eval_result).toEqual({ pass: false, score: 0.0, detail: 'Auto-validation failed' })
  })

  it('rejects invalid auto_validate type', async () => {
    const { POST } = await import('@/app/api/runtime/executions/[runId]/submit/route')
    const request = new NextRequest('http://localhost/api/runtime/executions/run-123/submit', {
      method: 'POST',
      body: JSON.stringify({
        status: 'completed',
        auto_validate: 'yes', // Should be boolean
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ runId: 'run-123' }) })
    expect(response.status).toBe(400)
  })
})
