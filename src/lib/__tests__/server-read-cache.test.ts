import { describe, expect, it, vi } from 'vitest'
import { createServerReadCache } from '@/lib/server-read-cache'

describe('server-read-cache', () => {
  it('reuses a cached value until ttl expires', async () => {
    vi.useFakeTimers()
    const cache = createServerReadCache<number>()
    const loader = vi.fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)

    await expect(cache.get('k', 1000, loader)).resolves.toBe(1)
    await expect(cache.get('k', 1000, loader)).resolves.toBe(1)
    expect(loader).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1001)

    await expect(cache.get('k', 1000, loader)).resolves.toBe(2)
    expect(loader).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('deduplicates concurrent loads for the same key', async () => {
    const cache = createServerReadCache<number>()
    let resolveLoader: ((value: number) => void) | null = null
    const loader = vi.fn(() => new Promise<number>((resolve) => {
      resolveLoader = resolve
    }))

    const first = cache.get('same', 1000, loader)
    const second = cache.get('same', 1000, loader)
    expect(loader).toHaveBeenCalledTimes(1)

    resolveLoader?.(42)

    await expect(first).resolves.toBe(42)
    await expect(second).resolves.toBe(42)
  })

  it('falls back to stale value when refresh fails', async () => {
    vi.useFakeTimers()
    const cache = createServerReadCache<number>()
    const loader = vi.fn()
      .mockResolvedValueOnce(7)
      .mockRejectedValueOnce(new Error('boom'))

    await expect(cache.get('stale', 1000, loader)).resolves.toBe(7)
    vi.advanceTimersByTime(1001)
    await expect(cache.get('stale', 1000, loader)).resolves.toBe(7)
    expect(loader).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
