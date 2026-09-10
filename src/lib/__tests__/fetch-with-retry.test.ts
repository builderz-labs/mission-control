import { describe, expect, it, vi } from 'vitest'
import { fetchWithRetry } from '@/lib/fetch-with-retry'

describe('fetchWithRetry', () => {
  it('retries transient responses and returns the recovered response', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const response = await fetchWithRetry('https://example.com/status', {}, { fetchImpl, timeoutMs: 100 })

    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stops after the configured attempt count', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))

    await expect(fetchWithRetry('https://example.com/status', {}, {
      attempts: 2,
      fetchImpl,
      timeoutMs: 100,
    })).rejects.toThrow('offline')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('honors a caller-provided deadline without replacing it', async () => {
    const callerSignal = AbortSignal.timeout(1_000)
    const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(callerSignal)
      return Promise.resolve(new Response('ok'))
    })

    await fetchWithRetry('https://example.com/status', { signal: callerSignal }, { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('does not retry non-idempotent POST responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('created', { status: 503 }))

    const response = await fetchWithRetry(
      'https://api.anthropic.com/v1/messages',
      { method: 'POST', body: '{}' },
      { fetchImpl, attempts: 3, timeoutMs: 100 },
    )

    expect(response.status).toBe(503)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not retry non-idempotent POST network errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('reset'))

    await expect(fetchWithRetry(
      'https://api.anthropic.com/v1/messages',
      { method: 'POST', body: '{}' },
      { fetchImpl, attempts: 3, timeoutMs: 100 },
    )).rejects.toThrow('reset')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
