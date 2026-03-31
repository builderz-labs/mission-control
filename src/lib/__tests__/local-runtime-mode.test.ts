import { describe, expect, it } from 'vitest'

import { detectLocalRuntimeAvailability, shouldUseLocalRuntimeAugmentation } from '@/lib/local-runtime-mode'

describe('shouldUseLocalRuntimeAugmentation', () => {
  it('enables local augmentation in local dashboard mode', () => {
    expect(shouldUseLocalRuntimeAugmentation('local', false)).toBe(true)
  })

  it('enables local augmentation in full mode when local sessions are available', () => {
    expect(shouldUseLocalRuntimeAugmentation('full', true)).toBe(true)
  })

  it('disables local augmentation in full mode without local session access', () => {
    expect(shouldUseLocalRuntimeAugmentation('full', false)).toBe(false)
  })
})

describe('detectLocalRuntimeAvailability', () => {
  it('treats openclawHome as local runtime support', () => {
    expect(detectLocalRuntimeAvailability({ openclawHome: true, claudeHome: false })).toBe(true)
  })

  it('treats claudeHome as local runtime support', () => {
    expect(detectLocalRuntimeAvailability({ openclawHome: false, claudeHome: true })).toBe(true)
  })

  it('returns false when neither local runtime source exists', () => {
    expect(detectLocalRuntimeAvailability({ openclawHome: false, claudeHome: false })).toBe(false)
    expect(detectLocalRuntimeAvailability(null)).toBe(false)
  })
})
