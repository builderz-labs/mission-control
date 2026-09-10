import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn()
const prepareMock = vi.fn()
const getTaskSubscribersMock = vi.fn()
const runOpenClawMock = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/command', () => ({
  runOpenClaw: (...args: unknown[]) => runOpenClawMock(...args),
}))
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare: prepareMock })),
  db_helpers: {
    getTaskSubscribers: (...args: unknown[]) => getTaskSubscribersMock(...args),
    createNotification: vi.fn(),
    logActivity: vi.fn(),
  },
}))

describe('POST /api/tasks/[id]/broadcast agent assignment', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRoleMock.mockReturnValue({
      user: { username: 'agent-a', role: 'operator', workspace_id: 7, agent_name: 'agent-a' },
    })
  })

  it('returns 403 for another agent task and does not message subscribers', async () => {
    prepareMock.mockReturnValue({
      get: vi.fn(() => ({ id: 42, workspace_id: 7, assigned_to: 'agent-b', title: 'Task' })),
      all: vi.fn(),
    })

    const { POST } = await import('@/app/api/tasks/[id]/broadcast/route')
    const response = await POST(
      new NextRequest('http://localhost/api/tasks/42/broadcast', {
        method: 'POST',
        body: JSON.stringify({ message: 'hello' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: '42' }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied: agent key may only access its own tasks.',
    })
    expect(getTaskSubscribersMock).not.toHaveBeenCalled()
    expect(runOpenClawMock).not.toHaveBeenCalled()
  })
})
