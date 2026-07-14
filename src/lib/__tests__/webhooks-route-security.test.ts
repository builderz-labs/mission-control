import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn()
const mutationLimiterMock = vi.fn(() => null)
const prepareMock = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: mutationLimiterMock }))
vi.mock('@/lib/validation', () => ({
  validateBody: vi.fn(),
  createWebhookSchema: {},
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare: prepareMock })),
}))

describe('webhooks route security', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mutationLimiterMock.mockReturnValue(null)
  })

  it('PUT fails closed when workspace_id is missing', async () => {
    requireRoleMock.mockReturnValue({
      user: { username: 'admin', role: 'admin' },
    })

    const { PUT } = await import('@/app/api/webhooks/route')
    const response = await PUT(
      new NextRequest('http://localhost/api/webhooks', {
        method: 'PUT',
        body: JSON.stringify({ id: 22 }),
        headers: { 'content-type': 'application/json' },
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace context required' })
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('DELETE fails closed when workspace_id is missing', async () => {
    requireRoleMock.mockReturnValue({
      user: { username: 'admin', role: 'admin' },
    })

    const { DELETE } = await import('@/app/api/webhooks/route')
    const response = await DELETE(
      new NextRequest('http://localhost/api/webhooks', {
        method: 'DELETE',
        body: JSON.stringify({ id: 22 }),
        headers: { 'content-type': 'application/json' },
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace context required' })
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('PUT scopes webhook lookup to the caller workspace', async () => {
    const getMock = vi.fn(() => undefined)
    prepareMock.mockReturnValue({ get: getMock })
    requireRoleMock.mockReturnValue({
      user: { username: 'admin', role: 'admin', workspace_id: 7 },
    })

    const { PUT } = await import('@/app/api/webhooks/route')
    const response = await PUT(
      new NextRequest('http://localhost/api/webhooks', {
        method: 'PUT',
        body: JSON.stringify({ id: 22 }),
        headers: { 'content-type': 'application/json' },
      }),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Webhook not found' })
    expect(getMock).toHaveBeenCalledWith(22, 7)
  })
})
