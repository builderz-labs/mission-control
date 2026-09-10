import { describe, expect, it } from 'vitest'
import { isPortOpenSync } from '@/lib/tcp-port'

describe('isPortOpenSync', () => {
  it('rejects invalid hosts and ports', () => {
    expect(isPortOpenSync('not a host', 18789)).toBe(false)
    expect(isPortOpenSync('127.0.0.1', 0)).toBe(false)
    expect(isPortOpenSync('127.0.0.1', 70000)).toBe(false)
  })

  it('returns false for a closed high port', () => {
    expect(isPortOpenSync('127.0.0.1', 1)).toBe(false)
  })
})
