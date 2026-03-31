import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('isHermesInstalled', () => {
  const originalPath = process.env.PATH
  const originalHermesBin = process.env.HERMES_BIN

  beforeEach(() => {
    vi.resetModules()
    delete process.env.HERMES_BIN
    process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env.PATH = originalPath
    if (originalHermesBin) {
      process.env.HERMES_BIN = originalHermesBin
    } else {
      delete process.env.HERMES_BIN
    }
  })

  it('detects Hermes via ~/.local/bin/hermes even when PATH does not include the binary', async () => {
    const { isHermesInstalled, clearHermesDetectionCache } = await import('@/lib/hermes-sessions')
    clearHermesDetectionCache()

    expect(isHermesInstalled()).toBe(true)
  })
})
