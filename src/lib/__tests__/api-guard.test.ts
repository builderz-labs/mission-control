/**
 * Tests for src/lib/api-guard.ts
 * Covers: apiSuccess, apiError, apiGuard (auth + rate-limit + error boundary),
 * inferLimiter (via method-based default selection).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Module mocks — use vi.hoisted so references are available at hoist time
// ---------------------------------------------------------------------------

const { mockRequireRole, mockReadLimiter, mockMutationLimiter, mockLoginLimiter } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockReadLimiter: vi.fn(),
  mockMutationLimiter: vi.fn(),
  mockLoginLimiter: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: mockRequireRole,
}))

vi.mock('@/lib/rate-limit', () => ({
  readLimiter: mockReadLimiter,
  mutationLimiter: mockMutationLimiter,
  loginLimiter: mockLoginLimiter,
  createRateLimiter: vi.fn(() => vi.fn(() => null)),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}))

// Import AFTER mocks
import { apiGuard, apiSuccess, apiError } from '@/lib/api-guard'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal NextRequest for testing. */
function makeReq(method: string = 'GET', path: string = '/api/test'): NextRequest {
  return new NextRequest(`http://127.0.0.1${path}`, { method })
}

const MOCK_ADMIN_USER = { id: 1, username: 'admin', role: 'admin' as const, workspace_id: 1 }

// ---------------------------------------------------------------------------
// apiSuccess
// ---------------------------------------------------------------------------

describe('apiSuccess', () => {
  it('returns 200 with success envelope by default', async () => {
    const res = apiSuccess({ foo: 'bar' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, data: { foo: 'bar' } })
  })

  it('uses custom status code', async () => {
    const res = apiSuccess({ id: 42 }, 201)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toEqual({ success: true, data: { id: 42 } })
  })

  it('accepts null data', async () => {
    const res = apiSuccess(null)
    const body = await res.json()
    expect(body).toEqual({ success: true, data: null })
  })

  it('accepts arrays as data', async () => {
    const res = apiSuccess([1, 2, 3])
    const body = await res.json()
    expect(body.data).toEqual([1, 2, 3])
  })
})

// ---------------------------------------------------------------------------
// apiError
// ---------------------------------------------------------------------------

describe('apiError', () => {
  it('returns 400 with error envelope by default', async () => {
    const res = apiError('Something went wrong')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: 'Something went wrong' })
  })

  it('uses custom status code', async () => {
    const res = apiError('Not found', 404)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: 'Not found' })
  })

  it('returns 500 for internal errors', async () => {
    const res = apiError('Internal server error', 500)
    expect(res.status).toBe(500)
  })

  it('returns 401 for auth errors', async () => {
    const res = apiError('Authentication required', 401)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// apiGuard — rate limiting
// ---------------------------------------------------------------------------

describe('apiGuard — rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: allow through (rate limiters return null means no block)
    mockReadLimiter.mockReturnValue(null)
    mockMutationLimiter.mockReturnValue(null)
    mockLoginLimiter.mockReturnValue(null)
    mockRequireRole.mockReturnValue({ user: MOCK_ADMIN_USER })
  })

  it('blocks request when read limiter returns a response (GET)', async () => {
    const rateLimitResponse = NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    mockReadLimiter.mockReturnValueOnce(rateLimitResponse)

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const guarded = apiGuard({ role: 'viewer', rateLimit: 'read' }, handler)

    const res = await guarded(makeReq('GET'))
    expect(res.status).toBe(429)
    expect(handler).not.toHaveBeenCalled()
  })

  it('blocks request when mutation limiter fires (POST)', async () => {
    const rateLimitResponse = NextResponse.json({ error: 'Slow down' }, { status: 429 })
    mockMutationLimiter.mockReturnValueOnce(rateLimitResponse)

    const handler = vi.fn()
    const guarded = apiGuard({ role: 'viewer', rateLimit: 'mutation' }, handler)

    const res = await guarded(makeReq('POST'))
    expect(res.status).toBe(429)
    expect(handler).not.toHaveBeenCalled()
  })

  it('skips rate limiting when rateLimit is "none"', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const guarded = apiGuard({ role: 'viewer', rateLimit: 'none' }, handler)

    await guarded(makeReq('GET'))

    // None of the limiters should have been called
    expect(mockReadLimiter).not.toHaveBeenCalled()
    expect(mockMutationLimiter).not.toHaveBeenCalled()
    expect(handler).toHaveBeenCalledOnce()
  })

  it('infers read limiter for GET when rateLimit not specified', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const guarded = apiGuard({ role: 'viewer' }, handler)

    await guarded(makeReq('GET'))
    expect(mockReadLimiter).toHaveBeenCalledOnce()
    expect(mockMutationLimiter).not.toHaveBeenCalled()
  })

  it('infers read limiter for HEAD when rateLimit not specified', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const guarded = apiGuard({ role: 'viewer' }, handler)

    await guarded(makeReq('HEAD'))
    expect(mockReadLimiter).toHaveBeenCalledOnce()
  })

  it('infers mutation limiter for POST when rateLimit not specified', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const guarded = apiGuard({ role: 'viewer' }, handler)

    await guarded(makeReq('POST'))
    expect(mockMutationLimiter).toHaveBeenCalledOnce()
    expect(mockReadLimiter).not.toHaveBeenCalled()
  })

  it('infers mutation limiter for DELETE when rateLimit not specified', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const guarded = apiGuard({ role: 'viewer' }, handler)

    await guarded(makeReq('DELETE'))
    expect(mockMutationLimiter).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// apiGuard — authentication
// ---------------------------------------------------------------------------

describe('apiGuard — authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadLimiter.mockReturnValue(null)
    mockMutationLimiter.mockReturnValue(null)
  })

  it('returns 401 when user is not authenticated', async () => {
    mockRequireRole.mockReturnValueOnce({ error: 'Authentication required', status: 401 })

    const handler = vi.fn()
    const guarded = apiGuard({ role: 'viewer', rateLimit: 'none' }, handler)

    const res = await guarded(makeReq())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 403 when user lacks required role', async () => {
    mockRequireRole.mockReturnValueOnce({ error: 'Requires admin role or higher', status: 403 })

    const handler = vi.fn()
    const guarded = apiGuard({ role: 'admin', rateLimit: 'none' }, handler)

    const res = await guarded(makeReq())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('Requires admin role or higher')
    expect(handler).not.toHaveBeenCalled()
  })

  it('calls handler when auth succeeds', async () => {
    mockRequireRole.mockReturnValueOnce({ user: MOCK_ADMIN_USER })

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ data: 'ok' }))
    const guarded = apiGuard({ role: 'viewer', rateLimit: 'none' }, handler)

    const res = await guarded(makeReq())
    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('passes auth object to handler', async () => {
    mockRequireRole.mockReturnValueOnce({ user: MOCK_ADMIN_USER })

    const handler = vi.fn().mockImplementation(async (_req, auth) => {
      return NextResponse.json({ username: auth.user.username })
    })
    const guarded = apiGuard({ role: 'viewer', rateLimit: 'none' }, handler)

    const res = await guarded(makeReq())
    const body = await res.json()
    expect(body.username).toBe('admin')
  })

  it('passes request to requireRole', async () => {
    mockRequireRole.mockReturnValueOnce({ user: MOCK_ADMIN_USER })

    const handler = vi.fn().mockResolvedValue(NextResponse.json({}))
    const guarded = apiGuard({ role: 'operator', rateLimit: 'none' }, handler)

    const req = makeReq()
    await guarded(req)
    expect(mockRequireRole).toHaveBeenCalledWith(req, 'operator')
  })
})

// ---------------------------------------------------------------------------
// apiGuard — error boundary
// ---------------------------------------------------------------------------

describe('apiGuard — error boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadLimiter.mockReturnValue(null)
    mockRequireRole.mockReturnValue({ user: MOCK_ADMIN_USER })
  })

  it('returns 500 when handler throws an error', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Unexpected crash'))
    const guarded = apiGuard({ role: 'viewer', rateLimit: 'none' }, handler)

    const res = await guarded(makeReq())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: 'Internal server error' })
  })

  it('returns 500 when handler throws a non-Error value', async () => {
    const handler = vi.fn().mockRejectedValue('string error')
    const guarded = apiGuard({ role: 'viewer', rateLimit: 'none' }, handler)

    const res = await guarded(makeReq())
    expect(res.status).toBe(500)
  })

  it('does not leak error details in the 500 response', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('DB password is abc123'))
    const guarded = apiGuard({ role: 'viewer', rateLimit: 'none' }, handler)

    const res = await guarded(makeReq())
    const body = await res.json()
    // Error detail must NOT appear in the response body
    expect(JSON.stringify(body)).not.toContain('abc123')
    expect(body.error).toBe('Internal server error')
  })
})

// ---------------------------------------------------------------------------
// apiGuard — rate limit precedes auth (defence-in-depth ordering)
// ---------------------------------------------------------------------------

describe('apiGuard — rate limit checked before auth', () => {
  it('rejects via rate limit without checking auth', async () => {
    vi.clearAllMocks()
    const rateLimitResponse = NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    mockReadLimiter.mockReturnValueOnce(rateLimitResponse)

    const handler = vi.fn()
    const guarded = apiGuard({ role: 'viewer', rateLimit: 'read' }, handler)

    const res = await guarded(makeReq('GET'))
    expect(res.status).toBe(429)
    // Auth should never have been checked — important for brute-force protection
    expect(mockRequireRole).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })
})
