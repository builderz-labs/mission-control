import { NextResponse } from 'next/server'

interface RateLimitEntry {
  count: number
  resetAt: number
}

interface RateLimiterOptions {
  windowMs: number
  maxRequests: number
  message?: string
  /** If true, MC_DISABLE_RATE_LIMIT will not bypass this limiter */
  critical?: boolean
}

// Trusted proxy IPs (comma-separated). Only parse XFF when behind known proxies.
const TRUSTED_PROXIES = new Set(
  (process.env.MC_TRUSTED_PROXIES || '').split(',').map(s => s.trim()).filter(Boolean)
)

/**
 * Extract client IP from request headers.
 * When MC_TRUSTED_PROXIES is set, takes the rightmost untrusted IP from x-forwarded-for.
 * Without trusted proxies, falls back to x-real-ip or 'unknown'.
 */
export function extractClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')

  if (xff && TRUSTED_PROXIES.size > 0) {
    // Walk the chain from right to left, skip trusted proxies, return first untrusted
    const ips = xff.split(',').map(s => s.trim())
    for (let i = ips.length - 1; i >= 0; i--) {
      if (!TRUSTED_PROXIES.has(ips[i])) return ips[i]
    }
  }

  // Fallback: x-real-ip (set by nginx/caddy) or 'unknown'
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

export function createRateLimiter(options: RateLimiterOptions) {
  const store = new Map<string, RateLimitEntry>()

  // Periodic cleanup every 60s
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key)
    }
  }, 60_000)
  // Don't prevent process exit
  if (cleanupInterval.unref) cleanupInterval.unref()

  return function checkRateLimit(request: Request): NextResponse | null {
    // Allow disabling non-critical rate limiting for E2E tests
    if (process.env.MC_DISABLE_RATE_LIMIT === '1' && !options.critical) return null
    const ip = extractClientIp(request)
    const now = Date.now()
    const entry = store.get(ip)

    if (!entry || now > entry.resetAt) {
      store.set(ip, { count: 1, resetAt: now + options.windowMs })
      return null
    }

    entry.count++
    if (entry.count > options.maxRequests) {
      return NextResponse.json(
        { error: options.message || 'Too many requests. Please try again later.' },
        { status: 429 }
      )
    }

    return null
  }
}

export const loginLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 5,
  message: 'Too many login attempts. Try again in a minute.',
  critical: true,
})

export const mutationLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
})

export const readLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 120,
})

export const heavyLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  message: 'Too many requests for this resource. Please try again later.',
})
