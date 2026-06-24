import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn()
const prepareMock = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare: prepareMock })),
  db_helpers: {
    logActivity: vi.fn(),
  },
}))
vi.mock('@/lib/agent-workspace', () => ({
  getAgentWorkspaceCandidates: vi.fn(() => []),
  readAgentWorkspaceFile: vi.fn(() => ({ exists: false, path: null, content: '' })),
}))
vi.mock('@/lib/paths', () => ({
  resolveWithin: vi.fn((base: string, name: string) => `${base}/${name}`),
}))

describe('agent memory route security', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('GET fails closed when workspace_id is missing', async () => {
    requireRoleMock.mockReturnValue({
      user: { username: 'agent-a', role: 'viewer', agent_name: 'agent-a' },
    })

    const { GET } = await import('@/app/api/agents/[id]/memory/route')
    const response = await GET(
      new NextRequest('http://localhost/api/agents/agent-a/memory'),
      { params: Promise.resolve({ id: 'agent-a' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace context required' })
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('GET allows an agent key to access its own memory route', async () => {
    prepareMock.mockImplementation((sql: string) => {
      if (sql.includes('SELECT * FROM agents')) {
        return {
          get: vi.fn(() => ({
            id: 42,
            name: 'agent-a',
            role: 'operator',
            updated_at: 123,
            config: null,
          })),
        }
      }

      if (sql.includes('SELECT working_memory, updated_at FROM agents')) {
        return {
          get: vi.fn(() => ({
            working_memory: 'hello',
            updated_at: 123,
          })),
        }
      }

      return { get: vi.fn(() => undefined) }
    })

    requireRoleMock.mockReturnValue({
      user: {
        username: 'agent-a',
        role: 'viewer',
        workspace_id: 7,
        agent_name: 'agent-a',
        agent_id: 42,
      },
    })

    const { GET } = await import('@/app/api/agents/[id]/memory/route')
    const response = await GET(
      new NextRequest('http://localhost/api/agents/42/memory'),
      { params: Promise.resolve({ id: '42' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      agent: { id: 42, name: 'agent-a' },
      working_memory: 'hello',
      source: 'database',
    })
  })

  it('GET denies same-workspace agent overreach before reading another agent memory', async () => {
    requireRoleMock.mockReturnValue({
      user: {
        username: 'agent-a',
        role: 'viewer',
        workspace_id: 7,
        agent_name: 'agent-a',
        agent_id: 42,
      },
    })

    const { GET } = await import('@/app/api/agents/[id]/memory/route')
    const response = await GET(
      new NextRequest('http://localhost/api/agents/99/memory'),
      { params: Promise.resolve({ id: '99' }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied: agent key may only access its own agent.',
    })
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('PUT denies same-workspace agent overreach before updating another agent memory', async () => {
    requireRoleMock.mockReturnValue({
      user: {
        username: 'agent-a',
        role: 'operator',
        workspace_id: 7,
        agent_name: 'agent-a',
        agent_id: 42,
      },
    })

    const { PUT } = await import('@/app/api/agents/[id]/memory/route')
    const response = await PUT(
      new NextRequest('http://localhost/api/agents/99/memory', {
        method: 'PUT',
        body: JSON.stringify({ working_memory: 'secret' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: '99' }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied: agent key may only access its own agent.',
    })
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('DELETE denies same-workspace agent overreach before clearing another agent memory', async () => {
    requireRoleMock.mockReturnValue({
      user: {
        username: 'agent-a',
        role: 'operator',
        workspace_id: 7,
        agent_name: 'agent-a',
        agent_id: 42,
      },
    })

    const { DELETE } = await import('@/app/api/agents/[id]/memory/route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/agents/99/memory', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: '99' }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied: agent key may only access its own agent.',
    })
    expect(prepareMock).not.toHaveBeenCalled()
  })
})
