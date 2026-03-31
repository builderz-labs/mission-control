import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn(() => ({ user: { username: 'tester', workspace_id: 1, role: 'operator' } }))
const mutationLimiterMock = vi.fn(() => null)
const validateBodyMock = vi.fn(async () => ({ data: {} }))
const normalizeTaskUpdateStatusMock = vi.fn(() => undefined)
const prepareMock = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: mutationLimiterMock }))
vi.mock('@/lib/validation', () => ({
  validateBody: validateBodyMock,
  updateTaskSchema: {},
}))
vi.mock('@/lib/task-status', () => ({ normalizeTaskUpdateStatus: normalizeTaskUpdateStatusMock }))
vi.mock('@/lib/mentions', () => ({ resolveMentionRecipients: vi.fn(() => ({ recipients: [], unresolved: [] })) }))
vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('@/lib/github-sync-engine', () => ({ pushTaskToGitHub: vi.fn() }))
vi.mock('@/lib/gnap-sync', () => ({ pushTaskToGnap: vi.fn(), removeTaskFromGnap: vi.fn() }))
vi.mock('@/lib/config', () => ({ config: { gnap: { enabled: false, autoSync: false, repoPath: '' } } }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

const currentTask = {
  id: 7,
  workspace_id: 1,
  title: 'Task title',
  description: 'desc',
  status: 'assigned',
  priority: 'medium',
  project_id: 1,
  assigned_to: 'Aegis',
  tags: '[]',
  metadata: '{}',
  created_at: 1000,
  updated_at: 1000,
}

const getMock = vi.fn((...args: any[]) => {
  if (args[0] === 7 && args[1] === 1) return currentTask
  return undefined
})

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({
    prepare: prepareMock,
  })),
  db_helpers: {
    createNotification: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    logActivity: vi.fn(),
  },
}))

describe('PUT /api/tasks/[id] no-op updates', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    prepareMock.mockImplementation((sql: string) => {
      if (sql.includes('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?')) {
        return { get: getMock }
      }
      throw new Error(`Unexpected SQL in test: ${sql}`)
    })
  })

  it('returns 200 unchanged=true instead of 400 when no update fields are provided', async () => {
    const { PUT } = await import('@/app/api/tasks/[id]/route')
    const request = new NextRequest('http://localhost/api/tasks/7', {
      method: 'PUT',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PUT(request, { params: Promise.resolve({ id: '7' }) })
    const payload = await response.json() as { unchanged?: boolean; task?: { id: number } }

    expect(response.status).toBe(200)
    expect(payload.unchanged).toBe(true)
    expect(payload.task?.id).toBe(7)
  })
})
