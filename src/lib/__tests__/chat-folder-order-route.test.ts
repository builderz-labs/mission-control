import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireRoleMock = vi.fn()
const isolationMock = vi.fn()
const loadMock = vi.fn()
const saveMock = vi.fn()
const limiterMock = vi.fn(() => null as NextResponse | null)

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/workspace-isolation', () => ({
  denyUnscopedResourceForStrictWorkspace: isolationMock,
}))
vi.mock('@/lib/chat-settings-kv', () => ({
  FOLDER_ORDER_KEY: 'chat.folder_order.v1',
  loadSettingValue: loadMock,
  saveSettingValue: saveMock,
}))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: limiterMock }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

const operator = { user: { id: 3, username: 'ops', role: 'operator', workspace_id: 1 } }

function request(method: 'GET' | 'PUT', body?: unknown) {
  return new NextRequest('http://localhost/api/chat/folder-order', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('folder-order route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRoleMock.mockReturnValue(operator)
    isolationMock.mockReturnValue(null)
    limiterMock.mockReturnValue(null)
    loadMock.mockReturnValue('["folder:b","folder:a"]')
  })

  it('returns the stored shared order', async () => {
    const { GET } = await import('@/app/api/chat/folder-order/route')
    const response = await GET(request('GET'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ order: ['folder:b', 'folder:a'] })
  })

  it('replaces the shared order', async () => {
    const { PUT } = await import('@/app/api/chat/folder-order/route')
    const response = await PUT(request('PUT', { order: ['folder:z', 'folder:z', 'folder:a'] }))
    expect(response.status).toBe(200)
    expect(saveMock).toHaveBeenCalledWith(
      'chat.folder_order.v1',
      JSON.stringify(['folder:z', 'folder:a']),
      expect.any(String),
      'ops',
    )
  })

  it('rejects a viewer PUT', async () => {
    requireRoleMock.mockReturnValue({ error: 'Requires operator role or higher', status: 403 })
    const { PUT } = await import('@/app/api/chat/folder-order/route')
    const response = await PUT(request('PUT', { order: ['folder:a'] }))
    expect(response.status).toBe(403)
    expect(saveMock).not.toHaveBeenCalled()
  })
})
