/**
 * Phase 3 BUILD D3 — Clerk webhook route tests.
 *
 * Verifies:
 *   - returns 503 when CLERK_WEBHOOK_SIGNING_SECRET unset
 *   - returns 400 when svix-* headers missing
 *   - returns 401 when Svix signature verification fails
 *   - returns 200 + destroys sessions on valid user.deleted
 *   - returns 200 + no-op on user.updated (irrelevant event)
 *   - returns 200 no-op when MC has no matching clerk_user_id
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const destroyAllUserSessionsSpy = vi.fn()
const logSecurityEventSpy = vi.fn()
const dbGetSpy = vi.fn()
const svixVerifySpy = vi.fn()

vi.mock('@/lib/auth', () => ({
  destroyAllUserSessions: (...args: unknown[]) => destroyAllUserSessionsSpy(...args),
}))

vi.mock('@/lib/security-events', () => ({
  logSecurityEvent: (...args: unknown[]) => logSecurityEventSpy(...args),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    prepare: () => ({ get: (...args: unknown[]) => dbGetSpy(...args) }),
  }),
}))

vi.mock('svix', () => ({
  Webhook: class {
    constructor(public secret: string) {}
    verify(body: string, headers: Record<string, string>) {
      return svixVerifySpy(body, headers, this.secret)
    }
  },
}))

// Import after mocks
import { POST } from '../route'

function makeReq(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/auth/clerk/webhook', {
    method: 'POST',
    headers: new Headers(headers),
    body,
  })
}

describe('Phase 3 D3 — Clerk webhook route', () => {
  const originalEnv = process.env

  beforeEach(() => {
    destroyAllUserSessionsSpy.mockClear()
    logSecurityEventSpy.mockClear()
    dbGetSpy.mockClear()
    svixVerifySpy.mockClear()
    process.env = { ...originalEnv }
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns 503 when CLERK_WEBHOOK_SIGNING_SECRET is unset', async () => {
    const res = await POST(makeReq('{}'))
    expect(res.status).toBe(503)
  })

  it('returns 400 when svix headers are missing', async () => {
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = 'whsec_test'
    const res = await POST(makeReq('{}'))
    expect(res.status).toBe(400)
  })

  it('returns 401 + logs security event on invalid signature', async () => {
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = 'whsec_test'
    svixVerifySpy.mockImplementation(() => {
      throw new Error('signature mismatch')
    })
    const res = await POST(
      makeReq('{}', {
        'svix-id': 'msg_1',
        'svix-timestamp': '1700000000',
        'svix-signature': 'v1,abc',
      }),
    )
    expect(res.status).toBe(401)
    expect(logSecurityEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'clerk_webhook_invalid_signature',
        severity: 'warning',
      }),
    )
  })

  it('returns 200 + destroys sessions on valid user.deleted', async () => {
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = 'whsec_test'
    svixVerifySpy.mockReturnValue({
      type: 'user.deleted',
      data: { id: 'user_2abc' },
    })
    dbGetSpy.mockReturnValue({ id: 42 })

    const res = await POST(
      makeReq(JSON.stringify({ type: 'user.deleted', data: { id: 'user_2abc' } }), {
        'svix-id': 'msg_1',
        'svix-timestamp': '1700000000',
        'svix-signature': 'v1,abc',
      }),
    )
    expect(res.status).toBe(200)
    expect(destroyAllUserSessionsSpy).toHaveBeenCalledWith(42)
    expect(logSecurityEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'clerk_webhook_sessions_destroyed' }),
    )
    const body = await res.json()
    expect(body.handled).toBe(true)
    expect(body.eventType).toBe('user.deleted')
    expect(body.mcUserId).toBe(42)
  })

  it('returns 200 + destroys sessions on session.revoked', async () => {
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = 'whsec_test'
    svixVerifySpy.mockReturnValue({
      type: 'session.revoked',
      data: { id: 'sess_x', user_id: 'user_2xyz' },
    })
    dbGetSpy.mockReturnValue({ id: 99 })

    const res = await POST(
      makeReq('{}', {
        'svix-id': 'msg_2',
        'svix-timestamp': '1700000000',
        'svix-signature': 'v1,abc',
      }),
    )
    expect(res.status).toBe(200)
    expect(destroyAllUserSessionsSpy).toHaveBeenCalledWith(99)
  })

  it('returns 200 no-op when no MC user matches clerk_user_id', async () => {
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = 'whsec_test'
    svixVerifySpy.mockReturnValue({
      type: 'user.deleted',
      data: { id: 'user_unknown' },
    })
    dbGetSpy.mockReturnValue(undefined)

    const res = await POST(
      makeReq('{}', {
        'svix-id': 'msg_3',
        'svix-timestamp': '1700000000',
        'svix-signature': 'v1,abc',
      }),
    )
    expect(res.status).toBe(200)
    expect(destroyAllUserSessionsSpy).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.handled).toBe(false)
    expect(body.reason).toBe('no-mc-user')
  })

  it('returns 200 no-op on irrelevant event types', async () => {
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = 'whsec_test'
    svixVerifySpy.mockReturnValue({
      type: 'user.updated',
      data: { id: 'user_2abc' },
    })

    const res = await POST(
      makeReq('{}', {
        'svix-id': 'msg_4',
        'svix-timestamp': '1700000000',
        'svix-signature': 'v1,abc',
      }),
    )
    expect(res.status).toBe(200)
    expect(destroyAllUserSessionsSpy).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.handled).toBe(false)
  })
})
