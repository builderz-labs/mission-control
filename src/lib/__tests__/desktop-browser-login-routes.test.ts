import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserById: vi.fn(),
  createSession: vi.fn(),
  issue: vi.fn(),
  approve: vi.fn(),
  consume: vi.fn(),
  isDesktop: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getUserFromRequest: mocks.getUser,
  getUserById: mocks.getUserById,
  createSession: mocks.createSession,
}))
vi.mock('@/lib/desktop-browser-login', () => ({
  issueDesktopBrowserLogin: mocks.issue,
  approveDesktopBrowserLogin: mocks.approve,
  consumeDesktopBrowserLogin: mocks.consume,
  isDesktopUserSession: mocks.isDesktop,
}))
vi.mock('@/lib/db', () => ({ logAuditEvent: mocks.audit }))
vi.mock('@/lib/rate-limit', () => ({
  desktopBrowserRequestLimiter: vi.fn(() => null),
  desktopBrowserApprovalLimiter: vi.fn(() => null),
  desktopBrowserPollLimiter: vi.fn(() => null),
  extractClientIp: vi.fn(() => '127.0.0.1'),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

const user = {
  id: 1, username: 'admin', display_name: 'Admin', role: 'admin',
  workspace_id: 1, tenant_id: 1, provider: 'local', created_at: 1,
  updated_at: 1, last_login_at: null, sessionId: 7,
}

function post(path: string, body: object = {}): Request {
  return new Request(`http://127.0.0.1:4000${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockReturnValue(user)
  mocks.getUserById.mockReturnValue(user)
  mocks.isDesktop.mockReturnValue(true)
  mocks.approve.mockReturnValue(true)
  mocks.createSession.mockReturnValue({ token: 'browser-session-token', expiresAt: 2_000 })
  process.env.MC_COOKIE_SECURE = 'false'
})

describe('desktop browser login routes', () => {
  it('issues a bounded one-time request without caching it', async () => {
    mocks.issue.mockReturnValue({ requestId: 'request', code: 'ABCD-2345', expiresAt: 1_300 })
    const { POST } = await import('@/app/api/auth/desktop-browser/request/route')
    const response = await POST(post('/api/auth/desktop-browser/request'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ request_id: 'request', code: 'ABCD-2345', expires_at: 1_300 })
  })

  it('requires an authenticated session that originated in the desktop app', async () => {
    const { POST } = await import('@/app/api/auth/desktop-browser/approve/route')
    mocks.getUser.mockReturnValueOnce(null)
    expect((await POST(post('/approve', { code: 'ABCD-2345' }))).status).toBe(401)
    mocks.isDesktop.mockReturnValueOnce(false)
    const response = await POST(post('/approve', { code: 'ABCD-2345' }))
    expect(response.status).toBe(403)
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it('approves the code without returning credentials', async () => {
    const { POST } = await import('@/app/api/auth/desktop-browser/approve/route')
    const response = await POST(post('/approve', { code: 'ABCD-2345' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mocks.approve).toHaveBeenCalledWith('ABCD-2345', user)
  })

  it('keeps pending requests cookieless and sets an HttpOnly cookie after approval', async () => {
    const { POST } = await import('@/app/api/auth/desktop-browser/poll/route')
    mocks.consume.mockReturnValueOnce({ status: 'pending', expiresAt: 1_300 })
    const pending = await POST(post('/poll', { request_id: 'request' }))
    expect(pending.status).toBe(200)
    expect(pending.headers.get('set-cookie')).toBeNull()

    mocks.consume.mockReturnValueOnce({ status: 'approved', userId: 1, workspaceId: 1, tenantId: 1 })
    const approved = await POST(post('/poll', { request_id: 'request' }))
    expect(approved.status).toBe(200)
    expect(await approved.json()).toEqual({ status: 'approved' })
    expect(approved.headers.get('set-cookie')).toMatch(/mc-session=.*HttpOnly.*SameSite=Strict/i)
  })

  it('does not create a session for an expired request', async () => {
    mocks.consume.mockReturnValue({ status: 'expired' })
    const { POST } = await import('@/app/api/auth/desktop-browser/poll/route')
    const response = await POST(post('/poll', { request_id: 'request' }))
    expect(response.status).toBe(410)
    expect(mocks.createSession).not.toHaveBeenCalled()
  })
})
