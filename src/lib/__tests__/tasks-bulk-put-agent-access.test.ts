import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn()
const validateBodyMock = vi.fn()
const prepareMock = vi.fn()
const transactionMock = vi.fn((fn: (tasks: unknown[]) => void) => fn)

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: vi.fn(() => null) }))
vi.mock('@/lib/validation', () => ({
  validateBody: (...args: unknown[]) => validateBodyMock(...args),
  createTaskSchema: {},
  bulkUpdateTaskStatusSchema: {},
}))
vi.mock('@/lib/mentions', () => ({ resolveMentionRecipients: vi.fn() }))
vi.mock('@/lib/task-status', () => ({
  normalizeTaskCreateStatus: vi.fn(),
  resolveTaskAssignee: vi.fn(),
}))
vi.mock('@/lib/task-dispatch', () => ({ reconcileDeferredTaskCompletions: vi.fn() }))
vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('@/lib/github-sync-engine', () => ({
  pushTaskToGitHub: vi.fn(),
  syncTaskOutbound: vi.fn(),
}))
vi.mock('@/lib/gnap-sync', () => ({ pushTaskToGnap: vi.fn() }))
vi.mock('@/lib/config', () => ({ config: { gnap: { enabled: false } } }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({
    prepare: prepareMock,
    transaction: (fn: (tasks: unknown[]) => void) => transactionMock(fn),
  })),
  db_helpers: { logActivity: vi.fn(), createNotification: vi.fn(), ensureTaskSubscription: vi.fn() },
}))

function agentUser() {
  return { username: 'agent-a', role: 'operator', workspace_id: 7, agent_name: 'agent-a' }
}

describe('PUT /api/tasks bulk agent assignment', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRoleMock.mockReturnValue({ user: agentUser() })
    validateBodyMock.mockResolvedValue({
      data: { tasks: [{ id: 42, status: 'in_progress' }] },
    })
  })

  it('returns 403 when an agent key moves another agent task', async () => {
    const getMock = vi.fn(() => ({
      id: 42,
      workspace_id: 7,
      assigned_to: 'agent-b',
      status: 'assigned',
    }))
    const runMock = vi.fn()
    prepareMock.mockReturnValue({ get: getMock, run: runMock })

    const { PUT } = await import('@/app/api/tasks/route')
    const response = await PUT(
      new NextRequest('http://localhost/api/tasks', {
        method: 'PUT',
        body: JSON.stringify({ tasks: [{ id: 42, status: 'in_progress' }] }),
        headers: { 'content-type': 'application/json' },
      }),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied: agent key may only access its own tasks.',
    })
    expect(runMock).not.toHaveBeenCalled()
  })

  it('updates when the task is assigned to the calling agent', async () => {
    const getMock = vi.fn(() => ({
      id: 42,
      workspace_id: 7,
      assigned_to: 'agent-a',
      status: 'assigned',
    }))
    const runMock = vi.fn()
    prepareMock.mockReturnValue({ get: getMock, run: runMock })

    const { PUT } = await import('@/app/api/tasks/route')
    const response = await PUT(
      new NextRequest('http://localhost/api/tasks', {
        method: 'PUT',
        body: JSON.stringify({ tasks: [{ id: 42, status: 'in_progress' }] }),
        headers: { 'content-type': 'application/json' },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, updated: 1 })
    expect(runMock).toHaveBeenCalled()
  })
})
