import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSystemUptimeSeconds } from '@/lib/security-scan'

describe('readSystemUptimeSeconds', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when uptime is unavailable', () => {
    vi.spyOn(os, 'uptime').mockImplementation(() => {
      throw new Error('EPERM')
    })

    expect(readSystemUptimeSeconds()).toBeNull()
  })

  it('returns uptime when available', () => {
    vi.spyOn(os, 'uptime').mockReturnValue(123)

    expect(readSystemUptimeSeconds()).toBe(123)
  })
})
