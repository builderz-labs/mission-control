import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn()
const prepareMock = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: vi.fn(() => null) }))
vi.mock('@/lib/validation', () => ({
  validateBody: vi.fn(),
  updateTaskSchema: {},
}))
vi.mock('@/lib/mentions', () => ({ resolveMentionRecipients: vi.fn(() => ({ recipients: [], unresolved: [] })) }))
vi.mock('@/lib/task-status', () => ({ normalizeTaskUpdateStatus: vi.fn() }))
vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('@/lib/github-sync-engine', () => ({ syncTaskOutbound: vi.fn() }))
vi.mock('@/lib/gnap-sync', () => ({ removeTaskFromGnap: vi.fn() }))
vi.mock('@/lib/config', () => ({ config: { gnap: { enabled: false, autoSync: false, repoPath: '' } } }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare: prepareMock })),
  db_helpers: {
    createNotification: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    logActivity: vi.fn(),
  },
}))

describe('task detail route security', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('GET fails closed when workspace_id is missing', async () => {
    requireRoleMock.mockReturnValue({
      user: { username: 'tester', role: 'viewer' },
    })

    const { GET } = await import('@/app/api/tasks/[id]/route')
    const response = await GET(
      new NextRequest('http://localhost/api/tasks/42'),
      { params: Promise.resolve({ id: '42' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace context required' })
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('GET denies cross-workspace access by scoping lookup to the caller workspace', async () => {
    const getMock = vi.fn(() => undefined)
    prepareMock.mockReturnValue({ get: getMock })
    requireRoleMock.mockReturnValue({
      user: { username: 'tester', role: 'viewer', workspace_id: 7 },
    })

    const { GET } = await import('@/app/api/tasks/[id]/route')
    const response = await GET(
      new NextRequest('http://localhost/api/tasks/42'),
      { params: Promise.resolve({ id: '42' }) },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Task not found' })
    expect(getMock).toHaveBeenCalledWith(42, 7)
  })

  it('GET denies agent overreach on another agent task', async () => {
    const getMock = vi.fn(() => ({
      id: 42,
      workspace_id: 7,
      assigned_to: 'agent-b',
      tags: '[]',
      metadata: '{}',
    }))
    prepareMock.mockReturnValue({ get: getMock })
    requireRoleMock.mockReturnValue({
      user: { username: 'agent-a', role: 'viewer', workspace_id: 7, agent_name: 'agent-a' },
    })

    const { GET } = await import('@/app/api/tasks/[id]/route')
    const response = await GET(
      new NextRequest('http://localhost/api/tasks/42'),
      { params: Promise.resolve({ id: '42' }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied: agent key may only access its own tasks.',
    })
  })
})
