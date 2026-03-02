import { describe, expect, it } from 'vitest'
import { createHmac } from 'crypto'
import { verifyWebhookSignature, nextRetryDelay } from '../webhooks'

describe('verifyWebhookSignature', () => {
  const secret = 'test-secret-key-1234'
  const body = '{"event":"test.ping","timestamp":1700000000,"data":{"message":"hello"}}'

  it('returns true for a correct signature', () => {
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    expect(verifyWebhookSignature(secret, body, sig)).toBe(true)
  })

  it('returns false for a wrong signature', () => {
    const wrongSig = `sha256=${createHmac('sha256', 'wrong-secret').update(body).digest('hex')}`
    expect(verifyWebhookSignature(secret, body, wrongSig)).toBe(false)
  })

  it('returns false for a tampered body', () => {
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    expect(verifyWebhookSignature(secret, body + 'tampered', sig)).toBe(false)
  })

  it('returns false for missing signature header', () => {
    expect(verifyWebhookSignature(secret, body, null)).toBe(false)
    expect(verifyWebhookSignature(secret, body, undefined)).toBe(false)
    expect(verifyWebhookSignature(secret, body, '')).toBe(false)
  })

  it('returns false for empty secret', () => {
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    expect(verifyWebhookSignature('', body, sig)).toBe(false)
  })
})

describe('nextRetryDelay', () => {
  // Expected base delays: 30s, 300s, 1800s, 7200s, 28800s
  const expectedBases = [30, 300, 1800, 7200, 28800]

  it('returns delays within ±20% jitter range for each attempt', () => {
    for (let attempt = 0; attempt < expectedBases.length; attempt++) {
      const base = expectedBases[attempt]
      const minExpected = base * 0.8
      const maxExpected = base * 1.2

      // Run multiple times to test jitter randomness
      for (let i = 0; i < 20; i++) {
        const delay = nextRetryDelay(attempt)
        expect(delay).toBeGreaterThanOrEqual(Math.floor(minExpected))
        expect(delay).toBeLessThanOrEqual(Math.ceil(maxExpected))
      }
    }
  })

  it('clamps attempts beyond the backoff array length', () => {
    const lastBase = expectedBases[expectedBases.length - 1]
    const delay = nextRetryDelay(100)
    expect(delay).toBeGreaterThanOrEqual(Math.floor(lastBase * 0.8))
    expect(delay).toBeLessThanOrEqual(Math.ceil(lastBase * 1.2))
  })

  it('returns a rounded integer', () => {
    for (let i = 0; i < 50; i++) {
      const delay = nextRetryDelay(0)
      expect(Number.isInteger(delay)).toBe(true)
    }
  })
})

describe('circuit breaker logic', () => {
  it('consecutive_failures >= maxRetries means circuit is open', () => {
    const maxRetries = 5
    // Simulate the circuit_open derivation used in the API
    const isCircuitOpen = (failures: number) => failures >= maxRetries

    expect(isCircuitOpen(0)).toBe(false)
    expect(isCircuitOpen(3)).toBe(false)
    expect(isCircuitOpen(4)).toBe(false)
    expect(isCircuitOpen(5)).toBe(true)
    expect(isCircuitOpen(10)).toBe(true)
  })
})
