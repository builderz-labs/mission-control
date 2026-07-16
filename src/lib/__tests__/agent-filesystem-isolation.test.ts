import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireRoleMock = vi.fn()
const getDatabaseMock = vi.fn()
const getWorkspaceIsolationMock = vi.fn()
const denyUnscopedResourceMock = vi.fn()
const getAgentWorkspaceCandidatesMock = vi.fn()
const readAgentWorkspaceFileMock = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
  db_helpers: { logActivity: vi.fn() },
}))
vi.mock('@/lib/workspace-isolation', () => ({
  getWorkspaceIsolation: getWorkspaceIsolationMock,
  denyUnscopedResourceForStrictWorkspace: denyUnscopedResourceMock,
}))
vi.mock('@/lib/agent-workspace', () => ({
  getAgentWorkspaceCandidates: getAgentWorkspaceCandidatesMock,
  readAgentWorkspaceFile: readAgentWorkspaceFileMock,
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

function authUser(role = 'operator') {
  return {
    user: {
      id: 9,
      username: 'strict-user',
      role,
      workspace_id: 7,
      tenant_id: 2,
    },
  }
}

describe('strict agent filesystem isolation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    denyUnscopedResourceMock.mockReturnValue(null)
    getWorkspaceIsolationMock.mockReturnValue('strict')
  })

  it('requires authentication before exposing SOUL templates', async () => {
    requireRoleMock.mockReturnValue({ error: 'Authentication required', status: 401 })
    const { PATCH } = await import('@/app/api/agents/[id]/soul/route')

    const response = await PATCH(
      new NextRequest('http://localhost/api/agents/42/soul?template=default', { method: 'PATCH' }),
      { params: Promise.resolve({ id: '42' }) },
    )

    expect(response.status).toBe(401)
    expect(denyUnscopedResourceMock).not.toHaveBeenCalled()
    expect(getDatabaseMock).not.toHaveBeenCalled()
  })

  it('denies strict agent-file reads before database or filesystem access', async () => {
    requireRoleMock.mockReturnValue(authUser('viewer'))
    denyUnscopedResourceMock.mockReturnValue(
      NextResponse.json({ error: 'Strict workspace filesystem denied' }, { status: 403 }),
    )
    const { GET } = await import('@/app/api/agents/[id]/files/route')

    const response = await GET(
      new NextRequest('http://localhost/api/agents/42/files'),
      { params: Promise.resolve({ id: '42' }) },
    )

    expect(response.status).toBe(403)
    expect(denyUnscopedResourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: 7, tenant_id: 2 }),
      'agent_filesystem',
      '/api/agents/42/files',
    )
    expect(getDatabaseMock).not.toHaveBeenCalled()
    expect(readAgentWorkspaceFileMock).not.toHaveBeenCalled()
  })

  it('serves strict SOUL state from the workspace-owned database only', async () => {
    requireRoleMock.mockReturnValue(authUser('viewer'))
    const get = vi.fn(() => ({
      id: 42,
      name: 'agent-a',
      role: 'operator',
      soul_content: 'database soul',
      updated_at: 123,
      config: JSON.stringify({ workspace: '/unowned/global/path' }),
    }))
    getDatabaseMock.mockReturnValue({ prepare: vi.fn(() => ({ get })) })
    const { GET } = await import('@/app/api/agents/[id]/soul/route')

    const response = await GET(
      new NextRequest('http://localhost/api/agents/42/soul'),
      { params: Promise.resolve({ id: '42' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      soul_content: 'database soul',
      source: 'database',
      available_templates: [],
    })
    expect(getAgentWorkspaceCandidatesMock).not.toHaveBeenCalled()
    expect(readAgentWorkspaceFileMock).not.toHaveBeenCalled()
  })

  it('rejects unsafe SOUL template identifiers before filesystem access', async () => {
    requireRoleMock.mockReturnValue(authUser())
    getWorkspaceIsolationMock.mockReturnValue('shared')
    const get = vi.fn(() => ({
      id: 42,
      name: 'agent-a',
      role: 'operator',
      soul_content: '',
      updated_at: 123,
      config: '{}',
    }))
    getDatabaseMock.mockReturnValue({ prepare: vi.fn(() => ({ get })) })
    const { PUT } = await import('@/app/api/agents/[id]/soul/route')

    const response = await PUT(
      new NextRequest('http://localhost/api/agents/42/soul', {
        method: 'PUT',
        body: JSON.stringify({ template_name: '../outside' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: '42' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid template name' })
    expect(getAgentWorkspaceCandidatesMock).not.toHaveBeenCalled()
  })
})
