import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn()
const agentTaskLimiterMock = vi.fn(() => null)
const prepareMock = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/rate-limit', () => ({ agentTaskLimiter: agentTaskLimiterMock }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare: prepareMock })),
}))

describe('task queue route security', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    agentTaskLimiterMock.mockReturnValue(null)
  })

  it('GET fails closed when workspace_id is missing', async () => {
    requireRoleMock.mockReturnValue({
      user: { username: 'agent-a', role: 'operator', agent_name: 'agent-a' },
    })

    const { GET } = await import('@/app/api/tasks/queue/route')
    const response = await GET(
      new NextRequest('http://localhost/api/tasks/queue?agent=agent-a'),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace context required' })
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('GET denies agent overreach when queueing for another agent', async () => {
    requireRoleMock.mockReturnValue({
      user: { username: 'agent-a', role: 'operator', agent_name: 'agent-a', workspace_id: 7 },
    })

    const { GET } = await import('@/app/api/tasks/queue/route')
    const response = await GET(
      new NextRequest('http://localhost/api/tasks/queue?agent=agent-b'),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied: agent key may only queue tasks for itself.',
    })
    expect(prepareMock).not.toHaveBeenCalled()
  })
})
