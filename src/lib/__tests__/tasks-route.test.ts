import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn()
const getDatabaseMock = vi.fn()
const getRuntimeDerivedTasksMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole: requireRoleMock,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
}))

vi.mock('@/lib/runtime-derived-tasks', () => ({
  getRuntimeDerivedTasks: getRuntimeDerivedTasksMock,
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { emit: vi.fn() },
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/mentions', () => ({
  resolveMentionRecipients: vi.fn(() => ({ unresolved: [] })),
}))

vi.mock('@/lib/task-status', () => ({
  normalizeTaskCreateStatus: vi.fn((status: string) => status),
}))

vi.mock('@/lib/github-sync-engine', () => ({
  pushTaskToGitHub: vi.fn(),
}))

vi.mock('@/lib/gnap-sync', () => ({
  pushTaskToGnap: vi.fn(),
}))

vi.mock('@/lib/config', () => ({
  config: {},
}))

vi.mock('@/lib/validation', () => ({
  validateBody: vi.fn(),
  createTaskSchema: {},
  bulkUpdateTaskStatusSchema: {},
}))

function makeDbTask(id: number, updatedAt: number) {
  return {
    id,
    title: `task-${id}`,
    description: `db-task-${id}`,
    status: 'assigned',
    priority: 'medium',
    assigned_to: 'agent',
    created_by: 'tester',
    created_at: updatedAt - 10,
    updated_at: updatedAt,
    tags: '[]',
    metadata: '{}',
    project_name: 'General',
    project_prefix: 'GEN',
    project_ticket_no: id,
  }
}

describe('GET /api/tasks', () => {
  beforeEach(() => {
    vi.resetModules()
    requireRoleMock.mockReset()
    getDatabaseMock.mockReset()
    getRuntimeDerivedTasksMock.mockReset()
    requireRoleMock.mockReturnValue({ user: { workspace_id: 1, username: 'j2w', role: 'admin' } })
  })

  it('does not leak runtime-derived tasks unless include_runtime=1 is set', async () => {
    const dbTasks = [makeDbTask(1, 300), makeDbTask(2, 200)]
    getRuntimeDerivedTasksMock.mockReturnValue([
      {
        id: -1001,
        title: 'runtime-task',
        status: 'review',
        priority: 'medium',
        assigned_to: 'growth-ops',
        created_by: 'runtime-sync',
        created_at: 400,
        updated_at: 400,
        tags: ['runtime'],
        metadata: { runtimeDerived: true, runtimeSource: 'growth_uploads' },
      },
    ])

    getDatabaseMock.mockReturnValue({
      prepare: (query: string) => {
        if (query.includes('COUNT(*) as total')) {
          return { get: () => ({ total: dbTasks.length }) }
        }
        if (query.includes('FROM tasks t')) {
          return { all: () => dbTasks }
        }
        throw new Error(`Unexpected query: ${query}`)
      },
    })

    const { GET } = await import('@/app/api/tasks/route')
    const response = await GET(new NextRequest('http://localhost/api/tasks'))
    const payload = await response.json()

    expect(payload.total).toBe(2)
    expect(payload.tasks).toHaveLength(2)
    expect(payload.tasks.map((task: any) => task.id)).toEqual([1, 2])
  })

  it('paginates merged runtime and db tasks without double-applying offset', async () => {
    const dbTasks = [makeDbTask(1, 400), makeDbTask(2, 200), makeDbTask(3, 100)]
    const runtimeTasks = [
      {
        id: -1002,
        title: 'runtime-hh',
        status: 'review',
        priority: 'high',
        assigned_to: 'hh-ops',
        created_by: 'runtime-sync',
        created_at: 300,
        updated_at: 300,
        tags: ['runtime'],
        metadata: { runtimeDerived: true, runtimeSource: 'hh_daily_status' },
      },
    ]
    getRuntimeDerivedTasksMock.mockReturnValue(runtimeTasks)

    const allSpy = vi.fn((...params: any[]) => {
      expect(params.at(-2)).toBe(3)
      expect(params.at(-1)).toBe(0)
      return dbTasks
    })

    getDatabaseMock.mockReturnValue({
      prepare: (query: string) => {
        if (query.includes('COUNT(*) as total')) {
          return { get: () => ({ total: dbTasks.length }) }
        }
        if (query.includes('FROM tasks t')) {
          return { all: allSpy }
        }
        throw new Error(`Unexpected query: ${query}`)
      },
    })

    const { GET } = await import('@/app/api/tasks/route')
    const response = await GET(new NextRequest('http://localhost/api/tasks?include_runtime=1&limit=1&offset=2'))
    const payload = await response.json()

    expect(payload.total).toBe(4)
    expect(payload.tasks).toHaveLength(1)
    expect(payload.tasks[0]?.id).toBe(2)
  })
})
