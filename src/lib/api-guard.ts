import { NextRequest, NextResponse } from 'next/server'
import { requireRole, type User } from '@/lib/auth'
import { createRateLimiter, mutationLimiter, readLimiter, loginLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Pre-built rate limiter for auth-sensitive endpoints (10 req/min per IP)
// ---------------------------------------------------------------------------

export const authLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  message: 'Too many authentication requests. Please try again later.',
  critical: true,
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuardOptions {
  /** Minimum role required to access the endpoint */
  readonly role: User['role']
  /**
   * Which rate limiter to apply.
   * - 'read'     -> 120 req/min (default for GET)
   * - 'mutation'  -> 60 req/min  (default for POST/PUT/PATCH/DELETE)
   * - 'auth'      -> 10 req/min  (auth-sensitive endpoints)
   * - 'login'     -> 5 req/min   (login endpoints)
   * - 'none'      -> skip rate limiting
   */
  readonly rateLimit?: 'read' | 'mutation' | 'auth' | 'login' | 'none'
}

type AuthResult = ReturnType<typeof requireRole>
type AuthSuccess = Extract<AuthResult, { user: unknown }>

type RouteHandler = (
  request: NextRequest,
  auth: AuthSuccess,
) => Promise<NextResponse> | NextResponse

const LIMITER_MAP = {
  read: readLimiter,
  mutation: mutationLimiter,
  auth: authLimiter,
  login: loginLimiter,
} as const

// ---------------------------------------------------------------------------
// Guard wrapper — combines auth check + rate limiting + error handling
// ---------------------------------------------------------------------------

/**
 * Wraps an API route handler with authentication and rate limiting.
 *
 * Usage:
 * ```ts
 * export const POST = apiGuard({ role: 'operator', rateLimit: 'mutation' }, async (req, auth) => {
 *   // auth.user is guaranteed to exist here
 *   return NextResponse.json({ ok: true })
 * })
 * ```
 */
export function apiGuard(
  options: GuardOptions,
  handler: RouteHandler,
): (request: NextRequest) => Promise<NextResponse> {
  return async function guardedHandler(request: NextRequest): Promise<NextResponse> {
    // 1. Rate limit check (runs before auth to block brute-force early)
    const limiterKey = options.rateLimit ?? inferLimiter(request.method)
    if (limiterKey !== 'none') {
      const limiter = LIMITER_MAP[limiterKey]
      const rateCheck = limiter(request)
      if (rateCheck) return rateCheck
    }

    // 2. Auth check
    const auth = requireRole(request, options.role)
    if ('error' in auth) {
      return apiError(auth.error ?? 'Unauthorized', auth.status ?? 401)
    }

    // 3. Execute handler with error boundary
    try {
      return await handler(request, auth)
    } catch (error) {
      logger.error({ err: error }, `${request.method} ${request.url} unhandled error`)
      return apiError('Internal server error', 500)
    }
  }
}

// ---------------------------------------------------------------------------
// Response envelope helpers
// ---------------------------------------------------------------------------

/**
 * Standard API response envelope.
 * All API routes should use these helpers for consistent response shape.
 */
export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status })
}

export function apiError(message: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Infer the default rate limiter from HTTP method */
function inferLimiter(method: string): keyof typeof LIMITER_MAP {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return 'read'
  }
  return 'mutation'
}
