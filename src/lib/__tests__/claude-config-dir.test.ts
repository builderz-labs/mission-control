import { describe, expect, it } from 'vitest'
import { claudeConfigDirForAgent, claudeSessionHomes } from '@/lib/claude-config-dir'

describe('claudeConfigDirForAgent', () => {
  it('never invents a config dir and ignores non-Claude fleet names', () => {
    const one = claudeConfigDirForAgent('claude-1')
    const two = claudeConfigDirForAgent('claude-2')
    const twenty = claudeConfigDirForAgent('claude-20x')
    const five = claudeConfigDirForAgent('claude-5x')
    expect(one).toEqual(twenty)
    expect(two).toEqual(five)
    if (one) expect(one.endsWith('.claude-account1')).toBe(true)
    if (two) expect(two.endsWith('.claude-account2')).toBe(true)
    expect(claudeConfigDirForAgent('codex')).toBeUndefined()
    expect(claudeConfigDirForAgent('claude')).toBeUndefined()
  })

  it('scans existing isolated homes without creating them', () => {
    const homes = claudeSessionHomes(null)
    for (const home of homes) {
      expect(home.includes('.claude-account') || home.endsWith('.claude')).toBe(true)
    }
  })
})
