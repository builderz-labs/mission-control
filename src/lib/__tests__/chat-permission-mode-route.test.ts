import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireRoleMock = vi.fn()
const isolationMock = vi.fn()
const loadMock = vi.fn()
const saveMock = vi.fn()
const auditMock = vi.fn()
const limiterMock = vi.fn(() => null as NextResponse | null)

vi.mock('@/lib/auth', () => ({
  requireRole: requireRoleMock,
  ROLE_LEVELS: { viewer: 0, operator: 1, admin: 2 },
}))
vi.mock('@/lib/workspace-isolation', () => ({
  denyUnscopedResourceForStrictWorkspace: isolationMock,
}))
vi.mock('@/lib/chat-settings-kv', () => ({
  permissionModeKey: (id: number) => `chat.permission_mode.user.${id}`,
  loadSettingValue: loadMock,
  saveSettingValue: saveMock,
}))
vi.mock('@/lib/db', () => ({ logAuditEvent: auditMock }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: limiterMock }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

function request(method: 'GET' | 'PUT', body?: unknown) {
  return new NextRequest('http://localhost/api/chat/permission-mode', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('permission-mode route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    isolationMock.mockReturnValue(null)
    limiterMock.mockReturnValue(null)
    loadMock.mockReturnValue('bypass')
  })

  it('hides bypass from viewers', async () => {
    requireRoleMock.mockReturnValue({ user: { id: 2, username: 'view', role: 'viewer' } })
    const { GET } = await import('@/app/api/chat/permission-mode/route')
    const response = await GET(request('GET'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ mode: 'ask', allowed: false })
    expect(loadMock).not.toHaveBeenCalled()
  })

  it('returns the operator stored mode and audits a toggle', async () => {
    requireRoleMock.mockReturnValue({ user: { id: 9, username: 'ops', role: 'operator' } })
    const route = await import('@/app/api/chat/permission-mode/route')
    const getRes = await route.GET(request('GET'))
    await expect(getRes.json()).resolves.toEqual({ mode: 'bypass', allowed: true })

    const putRes = await route.PUT(request('PUT', { mode: 'ask' }))
    expect(putRes.status).toBe(200)
    expect(saveMock).toHaveBeenCalledWith(
      'chat.permission_mode.user.9',
      'ask',
      expect.any(String),
      'ops',
    )
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'chat.permission_mode',
      actor: 'ops',
      detail: { from: 'bypass', to: 'ask' },
    }))
  })
})
