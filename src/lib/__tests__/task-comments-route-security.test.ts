import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn()
const prepareMock = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: vi.fn(() => null) }))
vi.mock('@/lib/validation', () => ({
  validateBody: vi.fn(),
  createCommentSchema: {},
}))
vi.mock('@/lib/mentions', () => ({ resolveMentionRecipients: vi.fn(() => ({ resolved: [], recipients: [], tokens: [], unresolved: [] })) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare: prepareMock })),
  db_helpers: {
    logActivity: vi.fn(),
    ensureTaskSubscription: vi.fn(),
    createNotification: vi.fn(),
    getTaskSubscribers: vi.fn(() => []),
  },
}))

describe('task comments route security', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('GET fails closed when workspace_id is missing', async () => {
    requireRoleMock.mockReturnValue({
      user: { username: 'tester', role: 'viewer' },
    })

    const { GET } = await import('@/app/api/tasks/[id]/comments/route')
    const response = await GET(
      new NextRequest('http://localhost/api/tasks/42/comments'),
      { params: Promise.resolve({ id: '42' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace context required' })
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('POST fails closed when workspace_id is missing', async () => {
    requireRoleMock.mockReturnValue({
      user: { username: 'tester', role: 'operator' },
    })

    const { POST } = await import('@/app/api/tasks/[id]/comments/route')
    const response = await POST(
      new NextRequest('http://localhost/api/tasks/42/comments', {
        method: 'POST',
        body: JSON.stringify({ content: 'hello' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: '42' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace context required' })
  })

  it('GET denies agent overreach on comments for another agent task', async () => {
    const getMock = vi.fn(() => ({
      id: 42,
      assigned_to: 'agent-b',
    }))
    prepareMock.mockReturnValue({ get: getMock, all: vi.fn(() => []) })
    requireRoleMock.mockReturnValue({
      user: { username: 'agent-a', role: 'viewer', workspace_id: 7, agent_name: 'agent-a' },
    })

    const { GET } = await import('@/app/api/tasks/[id]/comments/route')
    const response = await GET(
      new NextRequest('http://localhost/api/tasks/42/comments'),
      { params: Promise.resolve({ id: '42' }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied: agent key may only access its own tasks.',
    })
  })
})
