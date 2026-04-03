import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn(() => ({ user: { username: 'viewer', workspace_id: 1, role: 'viewer' } }))
const getDatabaseMock = vi.fn(() => ({ fake: true }))
const getExecutionSnapshotForAgentMock = vi.fn()

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
    getExecutionSnapshotForAgent: getExecutionSnapshotForAgentMock,
    OpenClawRuntimeError,
  }
})

describe('GET /api/runtime/openclaw/execution-tasks/[dispatchId]', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns snapshot for owning agent session', async () => {
    getExecutionSnapshotForAgentMock.mockReturnValue({ dispatch_id: 7, task_id: 7, title: 'Task' })

    const { GET } = await import('@/app/api/runtime/openclaw/execution-tasks/[dispatchId]/route')
    const request = new NextRequest('http://localhost/api/runtime/openclaw/execution-tasks/7?agent_id=openclaw-node-01&runtime_session_id=session-1')

    const response = await GET(request, { params: Promise.resolve({ dispatchId: '7' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(getExecutionSnapshotForAgentMock).toHaveBeenCalledWith(
      { fake: true },
      { dispatchId: 7, agentId: 'openclaw-node-01', runtimeSessionId: 'session-1', workspaceId: 1 },
    )
  })

  it('returns 400 when required identity is missing', async () => {
    const { GET } = await import('@/app/api/runtime/openclaw/execution-tasks/[dispatchId]/route')
    const request = new NextRequest('http://localhost/api/runtime/openclaw/execution-tasks/7')

    const response = await GET(request, { params: Promise.resolve({ dispatchId: '7' }) })
    expect(response.status).toBe(400)
  })

  it('maps ownership errors to status code', async () => {
    const { OpenClawRuntimeError } = await import('@/lib/openclaw-runtime')
    getExecutionSnapshotForAgentMock.mockImplementation(() => {
      throw new OpenClawRuntimeError('RUN_NOT_OWNED_BY_AGENT', 'forbidden', 403)
    })

    const { GET } = await import('@/app/api/runtime/openclaw/execution-tasks/[dispatchId]/route')
    const request = new NextRequest('http://localhost/api/runtime/openclaw/execution-tasks/7?agent_id=openclaw-node-01&runtime_session_id=session-2')

    const response = await GET(request, { params: Promise.resolve({ dispatchId: '7' }) })
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error.code).toBe('RUN_NOT_OWNED_BY_AGENT')
  })
})
