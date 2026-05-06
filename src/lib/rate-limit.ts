import { NextResponse } from 'next/server'
import { extractClientIpFromTrusted } from './request'
import { logSecurityEvent } from './security-events'

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
  /** Max entries in the backing map before evicting oldest (default: 10_000) */
  maxEntries?: number
}

const DEFAULT_MAX_ENTRIES = 10_000

/** Evict the entry with the earliest resetAt when at capacity */
function evictOldest(store: Map<string, RateLimitEntry>) {
  let oldestKey: string | null = null
  let oldestReset = Infinity
  for (const [key, entry] of store) {
    if (entry.resetAt < oldestReset) {
      oldestReset = entry.resetAt
      oldestKey = key
    }
  }
  if (oldestKey) store.delete(oldestKey)
}

// Trusted proxy IPs (comma-separated). Only parse XFF when behind known proxies.
const TRUSTED_PROXIES = new Set(
  (process.env.MC_TRUSTED_PROXIES || '').split(',').map(s => s.trim()).filter(Boolean)
)

// Re-export for external consumers
export { extractClientIpFromTrusted } from './request'

/**
 * Extract client IP using the global MC_TRUSTED_PROXIES set.
 */
export function extractClientIp(request: Request): string {
  return extractClientIpFromTrusted(request, TRUSTED_PROXIES)
}

export function createRateLimiter(options: RateLimiterOptions) {
  const store = new Map<string, RateLimitEntry>()
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES

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
    // In CI, standalone server runs with NODE_ENV=production but needs rate limit bypass
    if (process.env.MC_DISABLE_RATE_LIMIT === '1' && !options.critical && (process.env.NODE_ENV !== 'production' || process.env.MISSION_CONTROL_TEST_MODE === '1')) return null
    const ip = extractClientIp(request)
    const now = Date.now()
    const entry = store.get(ip)

    if (!entry || now > entry.resetAt) {
      if (!entry && store.size >= maxEntries) evictOldest(store)
      store.set(ip, { count: 1, resetAt: now + options.windowMs })
      return null
    }

    entry.count++
    if (entry.count > options.maxRequests) {
      try { logSecurityEvent({ event_type: 'rate_limit_hit', severity: 'warning', source: 'rate-limiter', detail: JSON.stringify({ ip }), ip_address: ip, workspace_id: 1, tenant_id: 1 }) } catch {}
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

// ---------------------------------------------------------------------------
// Per-agent rate limiter
// ---------------------------------------------------------------------------

/**
 * Rate limit by agent identity (x-agent-name header) instead of IP.
 * Useful for agent-facing endpoints where multiple agents share an IP
 * (e.g. all running on the same server) but each should have its own quota.
 *
 * Falls back to IP-based limiting if no agent name is provided.
 */
export function createAgentRateLimiter(options: RateLimiterOptions) {
  const store = new Map<string, RateLimitEntry>()
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES

  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key)
    }
  }, 60_000)
  if (cleanupInterval.unref) cleanupInterval.unref()

  return function checkAgentRateLimit(request: Request): NextResponse | null {
    if (process.env.MC_DISABLE_RATE_LIMIT === '1' && !options.critical && (process.env.NODE_ENV !== 'production' || process.env.MISSION_CONTROL_TEST_MODE === '1')) return null

    const agentName = (request.headers.get('x-agent-name') || '').trim()
    const key = agentName || `ip:${extractClientIp(request)}`
    const now = Date.now()
    const entry = store.get(key)

    if (!entry || now > entry.resetAt) {
      if (!entry && store.size >= maxEntries) evictOldest(store)
      store.set(key, { count: 1, resetAt: now + options.windowMs })
      return null
    }

    entry.count++
    if (entry.count > options.maxRequests) {
      try { logSecurityEvent({ event_type: 'rate_limit_hit', severity: 'warning', source: 'rate-limiter', agent_name: agentName || undefined, detail: JSON.stringify({ ip: key }), ip_address: typeof key === 'string' ? key : 'unknown', workspace_id: 1, tenant_id: 1 }) } catch {}
      const who = agentName ? `Agent "${agentName}"` : 'Client'
      return NextResponse.json(
        { error: options.message || `${who} has exceeded the rate limit. Please try again later.` },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((entry.resetAt - now) / 1000)),
            'X-RateLimit-Limit': String(options.maxRequests),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(entry.resetAt / 1000)),
          },
        }
      )
    }

    return null
  }
}

/** Per-agent heartbeat/status updates: 30/min per agent */
export const agentHeartbeatLimiter = createAgentRateLimiter({
  windowMs: 60_000,
  maxRequests: 30,
  message: 'Agent heartbeat rate limit exceeded.',
})

/** Per-agent task polling: 20/min per agent */
export const agentTaskLimiter = createAgentRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  message: 'Agent task polling rate limit exceeded.',
})

// ---------------------------------------------------------------------------
// Keyed rate limiter (arbitrary string key — e.g. user ID)
// ---------------------------------------------------------------------------

export function createKeyedRateLimiter(options: RateLimiterOptions) {
  const store = new Map<string, RateLimitEntry>()
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES

  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key)
    }
  }, 60_000)
  if (cleanupInterval.unref) cleanupInterval.unref()

  return function checkKeyedRateLimit(key: string): NextResponse | null {
    if (process.env.MC_DISABLE_RATE_LIMIT === '1' && !options.critical && (process.env.NODE_ENV !== 'production' || process.env.MISSION_CONTROL_TEST_MODE === '1')) return null

    const now = Date.now()
    const entry = store.get(key)

    if (!entry || now > entry.resetAt) {
      if (!entry && store.size >= maxEntries) evictOldest(store)
      store.set(key, { count: 1, resetAt: now + options.windowMs })
      return null
    }

    entry.count++
    if (entry.count > options.maxRequests) {
      try { logSecurityEvent({ event_type: 'rate_limit_hit', severity: 'warning', source: 'rate-limiter', detail: JSON.stringify({ key }), ip_address: 'n/a', workspace_id: 1, tenant_id: 1 }) } catch {}
      return NextResponse.json(
        { error: options.message || 'Too many requests. Please try again later.' },
        { status: 429 }
      )
    }

    return null
  }
}

/** Password change: 5/min per user ID (brute-force protection on current_password) */
export const passwordChangeLimiter = createKeyedRateLimiter({
  windowMs: 60_000,
  maxRequests: 5,
  message: 'Too many password change attempts. Try again in a minute.',
  critical: true,
})

/** Self-registration: 5/min per IP (prevent spam registrations) */
export const selfRegisterLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 5,
  message: 'Too many registration attempts. Please try again later.',
})
