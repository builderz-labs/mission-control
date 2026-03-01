import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRateLimiter } from '@/lib/rate-limit'

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeRequest(ip: string = '127.0.0.1'): Request {
    return new Request('http://localhost/api/test', {
      headers: new Headers({ 'x-forwarded-for': ip }),
    })
  }

  it('allows first request within limit (returns null)', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 })
    const result = limiter(makeRequest())
    expect(result).toBeNull()
  })

  it('allows requests up to the max limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 })
    expect(limiter(makeRequest())).toBeNull()
    expect(limiter(makeRequest())).toBeNull()
    expect(limiter(makeRequest())).toBeNull()
  })

  it('blocks request exceeding the limit with 429', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 })
    limiter(makeRequest())
    limiter(makeRequest())
    const blocked = limiter(makeRequest())
    expect(blocked).not.toBeNull()
    expect(blocked!.status).toBe(429)
  })

  it('uses custom message in 429 response', async () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      message: 'Slow down!',
    })
    limiter(makeRequest())
    const blocked = limiter(makeRequest())
    expect(blocked).not.toBeNull()
    const body = await blocked!.json()
    expect(body.error).toBe('Slow down!')
  })

  it('resets after the window expires', () => {
    const limiter = createRateLimiter({ windowMs: 10_000, maxRequests: 1 })
    expect(limiter(makeRequest())).toBeNull()
    expect(limiter(makeRequest())).not.toBeNull()

    // Advance past the window
    vi.advanceTimersByTime(11_000)

    // Should be allowed again
    expect(limiter(makeRequest())).toBeNull()
  })

  it('tracks different IPs independently', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 })
    expect(limiter(makeRequest('10.0.0.1'))).toBeNull()
    expect(limiter(makeRequest('10.0.0.2'))).toBeNull()
    // First IP now blocked
    expect(limiter(makeRequest('10.0.0.1'))).not.toBeNull()
    // Second IP now blocked
    expect(limiter(makeRequest('10.0.0.2'))).not.toBeNull()
  })
})
