import { afterEach, describe, expect, it, vi } from 'vitest'
import { ttlClear, ttlGet } from '../session-ttl-cache'

describe('ttlGet', () => {
  afterEach(() => {
    ttlClear()
    vi.useRealTimers()
  })

  it('reuses a value inside the ttl window and reloads after it expires', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    let calls = 0
    const load = () => {
      calls += 1
      return calls
    }
    expect(ttlGet('k', 1000, load)).toBe(1)
    expect(ttlGet('k', 1000, load)).toBe(1)
    vi.setSystemTime(2_100)
    expect(ttlGet('k', 1000, load)).toBe(2)
  })
})
