import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'src/lib/agent-runtimes.ts'), 'utf8')

describe('Hermes local install supply-chain contract', () => {
  it('downloads the official installer and pins it by SHA-256', () => {
    expect(source).toContain(
      "const hermesUrl = 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh'",
    )
    expect(source).toContain('process.env.MC_HERMES_INSTALLER_SHA256')
  })

  it('runs the installer with the cua-driver step disabled', () => {
    // The installer's Computer Use step pipes an unpinned third-party script
    // into /bin/bash. Skipping it is what keeps this path fully covered by the
    // SHA-256 pin above, so the flag is part of the security contract, not a
    // preference.
    expect(source).toContain(
      "[reviewed.scriptPath, '--skip-setup', '--skip-computer-use']",
    )
  })

  it('waives only the two pre-reviewed rule IDs on the Hermes call site', () => {
    const waivers = source.match(/\['cmd-shell-metachar', 'cmd-pipe-download'\]/g) ?? []
    // One for the OpenClaw call site, one for Hermes — no third waiver, and no
    // waiver of any other rule ID anywhere in this file.
    expect(waivers).toHaveLength(2)
  })
})
