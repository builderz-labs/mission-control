import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Linear API Client', () => {
  beforeEach(() => {
    vi.stubEnv('LINEAR_API_KEY', 'test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('throws error when LINEAR_API_KEY is not set', async () => {
    vi.unstubAllEnvs()
    const { linearFetch } = await import('@/lib/linear')
    await expect(linearFetch('{ test }')).rejects.toThrow('LINEAR_API_KEY not configured')
  })

  it('handles GraphQL errors from API', async () => {
    const { linearFetch } = await import('@/lib/linear')
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ errors: [{ message: 'Invalid query' }] }),
      })
    ) as any
    await expect(linearFetch('{ invalid }')).rejects.toThrow('Linear API error: Invalid query')
  })
})
