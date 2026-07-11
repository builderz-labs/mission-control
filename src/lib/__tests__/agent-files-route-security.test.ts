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
  db_helpers: { logActivity: vi.fn() },
}))
vi.mock('@/lib/agent-workspace', () => ({
  getAgentWorkspaceCandidates: vi.fn(() => []),
  readAgentWorkspaceFile: vi.fn(() => ({ exists: false, path: null, content: '' })),
}))
vi.mock('@/lib/paths', () => ({
  resolveWithin: vi.fn((base: string, name: string) => `${base}/${name}`),
}))

describe('agent files route security', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('GET denies same-workspace agent overreach before reading another agent files', async () => {
    requireRoleMock.mockReturnValue({
      user: { username: 'agent-a', role: 'viewer', workspace_id: 7, agent_name: 'agent-a', agent_id: 42 },
    })

    const { GET } = await import('@/app/api/agents/[id]/files/route')
    const response = await GET(
      new NextRequest('http://localhost/api/agents/99/files?file=MEMORY.md'),
      { params: Promise.resolve({ id: '99' }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Access denied: agent key may only access its own agent.',
    })
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('PUT denies same-workspace agent overreach before writing another agent file', async () => {
    requireRoleMock.mockReturnValue({
      user: { username: 'agent-a', role: 'operator', workspace_id: 7, agent_name: 'agent-a', agent_id: 42 },
    })

    const { PUT } = await import('@/app/api/agents/[id]/files/route')
    const response = await PUT(
      new NextRequest('http://localhost/api/agents/99/files', {
        method: 'PUT',
        body: JSON.stringify({ file: 'MEMORY.md', content: 'overwrite' }),
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
})
