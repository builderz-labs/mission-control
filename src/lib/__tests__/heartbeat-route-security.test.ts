import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn()
const getDatabaseMock = vi.fn()
const agentHeartbeatLimiterMock = vi.fn(() => null)

vi.mock('@/lib/auth', () => ({
  requireRole: requireRoleMock,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
  db_helpers: {
    getUnreadNotifications: vi.fn(() => []),
    updateAgentStatus: vi.fn(),
    logActivity: vi.fn(),
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  agentHeartbeatLimiter: agentHeartbeatLimiterMock,
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/lib/task-routing', () => ({
  resolveTaskImplementationTarget: vi.fn(() => ({})),
}))

describe('heartbeat route security', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    getDatabaseMock.mockReturnValue({ prepare: vi.fn() })
    agentHeartbeatLimiterMock.mockReturnValue(null)
  })

  it('GET fails closed when workspace_id is missing', async () => {
    requireRoleMock.mockReturnValue({
      user: { username: 'agent-a', role: 'viewer', agent_name: 'agent-a' },
    })

    const { GET } = await import('@/app/api/agents/[id]/heartbeat/route')
    const response = await GET(
      new NextRequest('http://localhost/api/agents/agent-a/heartbeat'),
      { params: Promise.resolve({ id: 'agent-a' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace context required' })
  })

  it('POST fails closed when workspace_id is missing', async () => {
    requireRoleMock.mockReturnValue({
      user: { username: 'agent-a', role: 'operator', agent_name: 'agent-a' },
    })

    const { POST } = await import('@/app/api/agents/[id]/heartbeat/route')
    const response = await POST(
      new NextRequest('http://localhost/api/agents/agent-a/heartbeat', { method: 'POST' }),
      { params: Promise.resolve({ id: 'agent-a' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace context required' })
  })

  it('GET denies agent overreach before reading agent records', async () => {
    const prepareMock = vi.fn()
    getDatabaseMock.mockReturnValue({ prepare: prepareMock })
    requireRoleMock.mockReturnValue({
      user: { username: 'agent-a', role: 'viewer', agent_name: 'agent-a', workspace_id: 7 },
    })

    const { GET } = await import('@/app/api/agents/[id]/heartbeat/route')
    const response = await GET(
      new NextRequest('http://localhost/api/agents/agent-b/heartbeat'),
      { params: Promise.resolve({ id: 'agent-b' }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied: agent key may only access its own agent.',
    })
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('GET denies numeric access when custom agent identity lacks authoritative agent_id', async () => {
    const prepareMock = vi.fn()
    getDatabaseMock.mockReturnValue({ prepare: prepareMock })
    requireRoleMock.mockReturnValue({
      user: { username: 'custom-agent', role: 'viewer', agent_name: 'agent-a', workspace_id: 7 },
    })

    const { GET } = await import('@/app/api/agents/[id]/heartbeat/route')
    const response = await GET(
      new NextRequest('http://localhost/api/agents/42/heartbeat'),
      { params: Promise.resolve({ id: '42' }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied: agent key may only access its own agent.',
    })
    expect(prepareMock).not.toHaveBeenCalled()
  })
})
