import { describe, expect, it } from 'vitest'
import {
  buildStyleRecoveryScript,
  shouldAttemptStyleRecovery,
  STYLE_RECOVERY_FLAG,
  STYLE_RECOVERY_PARAM,
} from '@/lib/style-recovery'

describe('shouldAttemptStyleRecovery', () => {
  it('requests reload when the style sentinel height is missing', () => {
    expect(shouldAttemptStyleRecovery({ sentinelHeight: 0, hasRecoveryFlag: false })).toBe(true)
  })

  it('does not reload when styles are already applied', () => {
    expect(shouldAttemptStyleRecovery({ sentinelHeight: 16, hasRecoveryFlag: false })).toBe(false)
  })

  it('does not reload twice after a failed attempt', () => {
    expect(shouldAttemptStyleRecovery({ sentinelHeight: 0, hasRecoveryFlag: true })).toBe(false)
  })
})

describe('buildStyleRecoveryScript', () => {
  it('embeds the recovery flag and cache-busting query parameter', () => {
    const script = buildStyleRecoveryScript()

    expect(script).toContain(STYLE_RECOVERY_FLAG)
    expect(script).toContain(STYLE_RECOVERY_PARAM)
    expect(script).toContain('bg-background')
    expect(script).toContain('window.location.replace')
  })
})
