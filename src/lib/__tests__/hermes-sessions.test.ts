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

  it('treats an existing Hermes home as installed even if CLI spawn checks are slow or unavailable', async () => {
    const spawnSyncMock = vi.fn(() => {
      throw new Error('spawn unavailable')
    })
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      return {
        ...actual,
        spawnSync: spawnSyncMock,
      }
    })

    const { isHermesInstalled, clearHermesDetectionCache } = await import('@/lib/hermes-sessions')
    clearHermesDetectionCache()

    expect(isHermesInstalled()).toBe(true)
    expect(spawnSyncMock).not.toHaveBeenCalled()
  })
})
