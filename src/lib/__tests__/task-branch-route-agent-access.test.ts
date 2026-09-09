import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn()
const prepareMock = vi.fn()
const fetchPullRequestsMock = vi.fn()
const createPullRequestMock = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: vi.fn(() => null) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('@/lib/github', () => ({
  createRef: vi.fn(),
  getRef: vi.fn(),
  fetchPullRequests: (...args: unknown[]) => fetchPullRequestsMock(...args),
  createPullRequest: (...args: unknown[]) => createPullRequestMock(...args),
}))
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare: prepareMock })),
  db_helpers: { logActivity: vi.fn() },
}))

const foreignTask = {
  id: 42,
  workspace_id: 7,
  assigned_to: 'agent-b',
  github_repo: 'org/repo',
  github_branch: 'feat/x',
  title: 'Task',
}

describe('GET/POST /api/tasks/[id]/branch agent assignment', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRoleMock.mockReturnValue({
      user: { username: 'agent-a', role: 'operator', workspace_id: 7, agent_name: 'agent-a' },
    })
    prepareMock.mockReturnValue({ get: vi.fn(() => foreignTask), run: vi.fn() })
  })

  it('GET returns 403 for another agent task and does not query GitHub', async () => {
    const { GET } = await import('@/app/api/tasks/[id]/branch/route')
    const response = await GET(
      new NextRequest('http://localhost/api/tasks/42/branch'),
      { params: Promise.resolve({ id: '42' }) },
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied: agent key may only access its own tasks.',
    })
    expect(fetchPullRequestsMock).not.toHaveBeenCalled()
  })

  it('POST returns 403 for another agent task and does not create a PR', async () => {
    const { POST } = await import('@/app/api/tasks/[id]/branch/route')
    const response = await POST(
      new NextRequest('http://localhost/api/tasks/42/branch', {
        method: 'POST',
        body: JSON.stringify({ action: 'create-pr' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: '42' }) },
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied: agent key may only access its own tasks.',
    })
    expect(createPullRequestMock).not.toHaveBeenCalled()
  })
})
