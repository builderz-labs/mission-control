import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn()
const prepareMock = vi.fn()
const reconcileMock = vi.fn(async () => undefined)

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/db', () => ({ getDatabase: vi.fn(() => ({ prepare: prepareMock })) }))
vi.mock('@/lib/task-dispatch', () => ({ reconcileDeferredTaskCompletions: reconcileMock }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: vi.fn(() => null) }))
vi.mock('@/lib/validation', () => ({ validateBody: vi.fn(), createTaskSchema: {}, bulkUpdateTaskStatusSchema: {} }))
vi.mock('@/lib/mentions', () => ({ resolveMentionRecipients: vi.fn() }))
vi.mock('@/lib/task-status', () => ({ normalizeTaskCreateStatus: vi.fn(), resolveTaskAssignee: vi.fn() }))
vi.mock('@/lib/github-sync-engine', () => ({ pushTaskToGitHub: vi.fn(), syncTaskOutbound: vi.fn() }))
vi.mock('@/lib/gnap-sync', () => ({ pushTaskToGnap: vi.fn() }))
vi.mock('@/lib/config', () => ({ config: { gnap: { enabled: false, autoSync: false, repoPath: '' } } }))
vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

describe('GET /api/tasks project group filtering', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRoleMock.mockReturnValue({ user: { username: 'tester', role: 'viewer', workspace_id: 7 } })
    prepareMock.mockImplementation((sql: string) => {
      if (sql.includes('COUNT(*) as total')) return { get: vi.fn(() => ({ total: 2 })) }
      return { all: vi.fn(() => [{ id: 1, title: 'Task', status: 'todo', tags: '[]', metadata: '{}' }]) }
    })
  })

  it.each([
    ['Platform', 'AND TRIM(p.group_name) = ?', ['Platform']],
    ['__ungrouped__', 'AND (p.group_name IS NULL OR TRIM(p.group_name) = \'\')', []],
  ])('filters by %s and keeps the count query in sync', async (group, predicate, groupParams) => {
    const { GET } = await import('@/app/api/tasks/route')
    const response = await GET(new NextRequest(`http://localhost/api/tasks?project_group=${encodeURIComponent(group)}`))

    expect(response.status).toBe(200)
    const statements = prepareMock.mock.calls.map(([sql]) => String(sql))
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain(predicate)
    expect(statements[1]).toContain(predicate)
    expect(prepareMock.mock.results[0].value.all).toHaveBeenCalledWith(7, ...groupParams, 50, 0)
    expect(prepareMock.mock.results[1].value.get).toHaveBeenCalledWith(7, ...groupParams)
    await expect(response.json()).resolves.toMatchObject({ total: 2, tasks: [{ id: 1 }] })
  })

  it('rejects oversized named group values before querying', async () => {
    const { GET } = await import('@/app/api/tasks/route')
    const response = await GET(new NextRequest(`http://localhost/api/tasks?project_group=${'x'.repeat(65)}`))

    expect(response.status).toBe(400)
    expect(prepareMock).not.toHaveBeenCalled()
  })
})
