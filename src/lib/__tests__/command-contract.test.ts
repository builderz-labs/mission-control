import { describe, expect, it } from 'vitest'
import { validateCommand, listRegisteredCommands } from '@/lib/command-contract'

describe('validateCommand — invalid inputs', () => {
  it('rejects empty string', () => {
    const r = validateCommand('')
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/empty/i)
  })

  it('rejects whitespace-only string', () => {
    const r = validateCommand('   ')
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/empty/i)
  })

  it('rejects a truly unknown command not in the registry', () => {
    const r = validateCommand('python3 -c "import os"')
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/not in command registry/i)
    expect(r.command).toBeUndefined()
  })
})

describe('validateCommand — known commands, no extra args allowed', () => {
  it('accepts git status with no args', () => {
    const r = validateCommand('git status')
    expect(r.valid).toBe(true)
    expect(r.command?.id).toBe('git:status')
    expect(r.command?.category).toBe('git')
    expect(r.command?.args).toEqual([])
  })

  it('rejects git status with extra args', () => {
    const r = validateCommand('git status --short')
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/does not accept extra arguments/i)
  })

  it('accepts pnpm skills:intake with no args', () => {
    const r = validateCommand('pnpm skills:intake')
    expect(r.valid).toBe(true)
    expect(r.command?.id).toBe('pnpm:skills-intake')
    expect(r.command?.category).toBe('pnpm')
  })

  it('rejects pnpm skills:intake with extra args', () => {
    const r = validateCommand('pnpm skills:intake --verbose')
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/does not accept extra arguments/i)
  })

  it('accepts node scripts/systems-curator.cjs', () => {
    const r = validateCommand('node scripts/systems-curator.cjs')
    expect(r.valid).toBe(true)
    expect(r.command?.id).toBe('node:systems-curator')
    expect(r.command?.category).toBe('node')
    expect(r.command?.args).toEqual([])
  })

  it('rejects node scripts/systems-curator.cjs with extra args', () => {
    const r = validateCommand('node scripts/systems-curator.cjs --json')
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/does not accept extra arguments/i)
  })

  it('accepts node scripts/mc-coordinator.cjs', () => {
    const r = validateCommand('node scripts/mc-coordinator.cjs')
    expect(r.valid).toBe(true)
    expect(r.command?.id).toBe('node:mc-coordinator')
  })

  it('accepts node scripts/passive-income-bot.cjs', () => {
    const r = validateCommand('node scripts/passive-income-bot.cjs')
    expect(r.valid).toBe(true)
    expect(r.command?.id).toBe('node:passive-income-bot')
  })
})

describe('validateCommand — known commands, any args allowed', () => {
  it('accepts git log with no args', () => {
    const r = validateCommand('git log')
    expect(r.valid).toBe(true)
    expect(r.command?.id).toBe('git:log')
    expect(r.command?.args).toEqual([])
  })

  it('accepts git log with flags', () => {
    const r = validateCommand('git log --oneline --graph')
    expect(r.valid).toBe(true)
    expect(r.command?.args).toEqual(['--oneline', '--graph'])
  })

  it('accepts git diff with no args', () => {
    const r = validateCommand('git diff')
    expect(r.valid).toBe(true)
    expect(r.command?.id).toBe('git:diff')
  })

  it('accepts git diff with a target', () => {
    const r = validateCommand('git diff HEAD~1')
    expect(r.valid).toBe(true)
    expect(r.command?.args).toEqual(['HEAD~1'])
  })
})

describe('validateCommand — known risky commands (structurally valid, policy enforced elsewhere)', () => {
  it('accepts git push as structurally valid', () => {
    const r = validateCommand('git push')
    expect(r.valid).toBe(true)
    expect(r.command?.id).toBe('git:push')
    expect(r.command?.category).toBe('git')
  })

  it('accepts git push with remote and branch args', () => {
    const r = validateCommand('git push origin main')
    expect(r.valid).toBe(true)
    expect(r.command?.args).toEqual(['origin', 'main'])
  })

  it('accepts git reset without destructive flags', () => {
    const r = validateCommand('git reset --soft HEAD~1')
    expect(r.valid).toBe(true)
    expect(r.command?.id).toBe('git:reset')
  })

  it('accepts git clean as structurally valid', () => {
    const r = validateCommand('git clean -fd')
    expect(r.valid).toBe(true)
    expect(r.command?.id).toBe('git:clean')
  })

  it('accepts curl as structurally valid', () => {
    const r = validateCommand('curl https://example.com')
    expect(r.valid).toBe(true)
    expect(r.command?.id).toBe('shell:curl')
    expect(r.command?.category).toBe('shell')
  })

  it('accepts rm as structurally valid', () => {
    const r = validateCommand('rm -rf /tmp/cache')
    expect(r.valid).toBe(true)
    expect(r.command?.id).toBe('shell:rm')
  })

  it('accepts unlink as structurally valid', () => {
    const r = validateCommand('unlink /tmp/stale.lock')
    expect(r.valid).toBe(true)
    expect(r.command?.id).toBe('shell:unlink')
  })
})

describe('validateCommand — argument guards', () => {
  describe('rm', () => {
    it('blocks rm -rf / (root deletion)', () => {
      const r = validateCommand('rm -rf /')
      expect(r.valid).toBe(false)
      expect(r.reason).toMatch(/root deletion/i)
      expect(r.command).toBeUndefined()
    })

    it('blocks rm with --no-preserve-root', () => {
      const r = validateCommand('rm --no-preserve-root -rf /')
      expect(r.valid).toBe(false)
      expect(r.reason).toMatch(/--no-preserve-root/i)
    })

    it('blocks rm with / as a standalone arg in any position', () => {
      const r = validateCommand('rm -r /')
      expect(r.valid).toBe(false)
      expect(r.reason).toMatch(/root deletion/i)
    })

    it('allows rm targeting a subdirectory', () => {
      const r = validateCommand('rm -rf /tmp/cache')
      expect(r.valid).toBe(true)
      expect(r.command?.id).toBe('shell:rm')
      expect(r.command?.args).toEqual(['-rf', '/tmp/cache'])
    })

    it('allows rm targeting a relative path', () => {
      const r = validateCommand('rm -f ./dist/old-bundle.js')
      expect(r.valid).toBe(true)
    })
  })

  describe('git reset', () => {
    it('blocks git reset --hard', () => {
      const r = validateCommand('git reset --hard')
      expect(r.valid).toBe(false)
      expect(r.reason).toMatch(/--hard/i)
      expect(r.command).toBeUndefined()
    })

    it('blocks git reset --hard with a ref', () => {
      const r = validateCommand('git reset --hard HEAD~1')
      expect(r.valid).toBe(false)
      expect(r.reason).toMatch(/--hard/i)
    })

    it('allows git reset --soft', () => {
      const r = validateCommand('git reset --soft HEAD~1')
      expect(r.valid).toBe(true)
      expect(r.command?.id).toBe('git:reset')
    })

    it('allows git reset --mixed', () => {
      const r = validateCommand('git reset --mixed HEAD~2')
      expect(r.valid).toBe(true)
    })
  })

  describe('curl', () => {
    it('blocks curl with an http:// URL', () => {
      const r = validateCommand('curl http://example.com')
      expect(r.valid).toBe(false)
      expect(r.reason).toMatch(/non-https/i)
      expect(r.command).toBeUndefined()
    })

    it('blocks curl with http:// among other args', () => {
      const r = validateCommand('curl -o output.json http://api.example.com/data')
      expect(r.valid).toBe(false)
      expect(r.reason).toMatch(/non-https/i)
    })

    it('allows curl with an https:// URL', () => {
      const r = validateCommand('curl https://example.com')
      expect(r.valid).toBe(true)
      expect(r.command?.id).toBe('shell:curl')
    })

    it('allows curl with flags and an https:// URL', () => {
      const r = validateCommand('curl -fsSL https://api.example.com/data')
      expect(r.valid).toBe(true)
      expect(r.command?.args).toEqual(['-fsSL', 'https://api.example.com/data'])
    })
  })
})

describe('validateCommand — return shape', () => {
  it('valid result has command with id, category, intent, risk_profile, args', () => {
    const r = validateCommand('git log')
    expect(r.valid).toBe(true)
    expect(typeof r.command?.id).toBe('string')
    expect(typeof r.command?.category).toBe('string')
    expect(typeof r.command?.intent).toBe('string')
    expect(typeof r.command?.risk_profile).toBe('string')
    expect(Array.isArray(r.command?.args)).toBe(true)
  })

  it('invalid result has no command field', () => {
    const r = validateCommand('unknown-command')
    expect(r.valid).toBe(false)
    expect(r.command).toBeUndefined()
  })
})

describe('validateCommand — intent and risk_profile mappings', () => {
  const cases: Array<{ raw: string; intent: string; risk_profile: string }> = [
    { raw: 'git status',                            intent: 'read',               risk_profile: 'low'    },
    { raw: 'git log',                               intent: 'read',               risk_profile: 'low'    },
    { raw: 'git diff',                              intent: 'read',               risk_profile: 'low'    },
    { raw: 'git push',                              intent: 'write',              risk_profile: 'medium' },
    { raw: 'git reset --soft HEAD~1',               intent: 'history_rewrite',    risk_profile: 'high'   },
    { raw: 'git clean -fd',                         intent: 'filesystem_delete',  risk_profile: 'high'   },
    { raw: 'pnpm skills:intake',                    intent: 'package_management', risk_profile: 'medium' },
    { raw: 'node scripts/systems-curator.cjs',      intent: 'process_execution',  risk_profile: 'low'    },
    { raw: 'node scripts/mc-coordinator.cjs',       intent: 'process_execution',  risk_profile: 'low'    },
    { raw: 'node scripts/passive-income-bot.cjs',   intent: 'process_execution',  risk_profile: 'medium' },
    { raw: 'curl https://example.com',              intent: 'network_request',    risk_profile: 'medium' },
    { raw: 'wget https://example.com',              intent: 'network_request',    risk_profile: 'medium' },
    { raw: 'rm -rf /tmp/cache',                     intent: 'filesystem_delete',  risk_profile: 'high'   },
    { raw: 'unlink /tmp/stale.lock',                intent: 'filesystem_delete',  risk_profile: 'medium' },
  ]

  cases.forEach(({ raw, intent, risk_profile }) => {
    it(`"${raw}" → intent: ${intent}, risk: ${risk_profile}`, () => {
      const r = validateCommand(raw)
      expect(r.valid).toBe(true)
      expect(r.command?.intent).toBe(intent)
      expect(r.command?.risk_profile).toBe(risk_profile)
    })
  })
})

describe('listRegisteredCommands', () => {
  it('returns a non-empty array of strings', () => {
    const cmds = listRegisteredCommands()
    expect(Array.isArray(cmds)).toBe(true)
    expect(cmds.length).toBeGreaterThan(0)
    cmds.forEach(c => expect(typeof c).toBe('string'))
  })

  it('includes expected base commands', () => {
    const cmds = listRegisteredCommands()
    expect(cmds).toContain('git status')
    expect(cmds).toContain('git log')
    expect(cmds).toContain('git diff')
    expect(cmds).toContain('pnpm skills:intake')
    expect(cmds).toContain('node scripts/systems-curator.cjs')
  })

  it('includes known risky commands (policy enforced by coordination, not contract)', () => {
    const cmds = listRegisteredCommands()
    expect(cmds).toContain('git push')
    expect(cmds).toContain('rm')
    expect(cmds).toContain('curl')
  })
})
