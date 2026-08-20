import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { POST } from './route'

// Mock dependencies
vi.mock('@/lib/auth', () => ({
  destroySession: vi.fn(),
  getUserFromRequest: vi.fn(() => null),
}))

vi.mock('@/lib/db', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/session-cookie', async () => {
  const actual = await vi.importActual<typeof import('@/lib/session-cookie')>('@/lib/session-cookie')
  return {
    ...actual,
    parseAllMcSessionCookies: vi.fn(() => []),
  }
})

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('expires both __Host-mc-session and mc-session cookies', async () => {
    const request = new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: new Headers({
        'cookie': '__Host-mc-session=secure-token; mc-session=legacy-token',
      }),
    })

    const response = await POST(request)
    const setCookieHeaders = response.headers.getSetCookie()

    expect(setCookieHeaders).toHaveLength(2)
    expect(setCookieHeaders.some((h) => h.includes('__Host-mc-session=;'))).toBe(true)
    expect(setCookieHeaders.some((h) => h.includes('mc-session=;'))).toBe(true)
    expect(setCookieHeaders.every((h) => h.includes('Max-Age=0'))).toBe(true)
  })

  it('destroys all presented session tokens', async () => {
    const { destroySession } = await import('@/lib/auth')
    const { parseAllMcSessionCookies } = await import('@/lib/session-cookie')

    vi.mocked(parseAllMcSessionCookies).mockReturnValue(['token1', 'token2'])

    const request = new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: new Headers({
        'cookie': '__Host-mc-session=token1; mc-session=token2',
      }),
    })

    await POST(request)

    expect(destroySession).toHaveBeenCalledTimes(2)
    expect(destroySession).toHaveBeenCalledWith('token1')
    expect(destroySession).toHaveBeenCalledWith('token2')
  })
})
