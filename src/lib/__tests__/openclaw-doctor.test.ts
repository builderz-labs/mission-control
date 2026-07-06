import { describe, expect, it } from 'vitest'
import { parseOpenClawDoctorOutput } from '@/lib/openclaw-doctor'

describe('parseOpenClawDoctorOutput', () => {
  it('marks warning output as fixable and extracts bullet issues', () => {
    const result = parseOpenClawDoctorOutput(`
Config warnings
- tools.exec.safeBins includes interpreter/runtime 'bun' without profile
- tools.exec.safeBins includes interpreter/runtime 'python3' without profile
Run: openclaw doctor --fix
`, 0)

    expect(result.healthy).toBe(false)
    expect(result.level).toBe('warning')
    expect(result.category).toBe('general')
    expect(result.canFix).toBe(true)
    expect(result.issues).toEqual([
      "tools.exec.safeBins includes interpreter/runtime 'bun' without profile",
      "tools.exec.safeBins includes interpreter/runtime 'python3' without profile",
    ])
  })

  it('marks invalid config output as an error', () => {
    const result = parseOpenClawDoctorOutput(`
Invalid config at /home/openclaw/.openclaw/openclaw.json:
- <root>: Unrecognized key: "test"
Config invalid
File: $OPENCLAW_HOME/openclaw.json
Problem:
- <root>: Unrecognized key: "test"
Run: openclaw doctor --fix
`, 1)

    expect(result.healthy).toBe(false)
    expect(result.level).toBe('error')
    expect(result.category).toBe('config')
    expect(result.summary).toContain('Unrecognized key')
  })

  it('classifies state integrity warnings separately from config drift', () => {
    const result = parseOpenClawDoctorOutput(`
◇  State integrity
- Multiple state directories detected. This can split session history.
- Found 1 orphan transcript file(s) in ~/.openclaw/agents/jarv/sessions.
Run "openclaw doctor --fix" to apply changes.
`, 0)

    expect(result.healthy).toBe(false)
    expect(result.level).toBe('warning')
    expect(result.category).toBe('state')
    expect(result.summary).toContain('Multiple state directories')
  })

  it('suppresses foreign state-directory warnings for the active instance', () => {
    const result = parseOpenClawDoctorOutput(`
◇  State integrity
- Multiple state directories detected. This can split session history.
  - /home/nefes/.openclaw
  Active state dir: ~/.openclaw
- Found 1 orphan transcript file(s) in ~/.openclaw/agents/jarv/sessions.
Run "openclaw doctor --fix" to apply changes.
`, 0, { stateDir: '/home/openclaw/.openclaw' })

    expect(result.healthy).toBe(false)
    expect(result.level).toBe('warning')
    expect(result.category).toBe('state')
    expect(result.issues).toEqual([
      'Found 1 orphan transcript file(s) in ~/.openclaw/agents/jarv/sessions.',
    ])
    expect(result.raw).not.toContain('/home/nefes/.openclaw')
  })

  it('suppresses foreign state-directory warnings when the active dir is shown via OPENCLAW_HOME alias', () => {
    const result = parseOpenClawDoctorOutput(`
▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
┌  OpenClaw doctor
│
◇  State integrity
- Multiple state directories detected. This can split session history.
  - $OPENCLAW_HOME/.openclaw
  - /home/nefes/.openclaw
  Active state dir: $OPENCLAW_HOME
- Found 11 orphan transcript file(s) in $OPENCLAW_HOME/agents/jarv/sessions.
Run "openclaw doctor --fix" to apply changes.
`, 0, { stateDir: '/home/openclaw/.openclaw' })

    expect(result.summary).toContain('Found 11 orphan transcript file(s)')
    expect(result.raw).not.toContain('/home/nefes/.openclaw')
    expect(result.raw).not.toContain('Multiple state directories detected')
  })

  it('parses state integrity blocks when lines are prefixed by box-drawing gutters', () => {
    const result = parseOpenClawDoctorOutput(`
┌  OpenClaw doctor
│
◇  State integrity
│  - Multiple state directories detected. This can split session history.
│    - $OPENCLAW_HOME/.openclaw
│    - /home/nefes/.openclaw
│    Active state dir: $OPENCLAW_HOME
│  - Found 11 orphan transcript file(s) in $OPENCLAW_HOME/agents/jarv/sessions.
Run "openclaw doctor --fix" to apply changes.
`, 0, { stateDir: '/home/openclaw/.openclaw' })

    expect(result.level).toBe('warning')
    expect(result.category).toBe('state')
    expect(result.issues).toEqual([
      'Found 11 orphan transcript file(s) in $OPENCLAW_HOME/agents/jarv/sessions.',
    ])
    expect(result.raw).not.toContain('/home/nefes/.openclaw')
    expect(result.raw).not.toContain('Multiple state directories detected')
  })

  it('marks clean output as healthy', () => {
    const result = parseOpenClawDoctorOutput('OK: configuration valid', 0)

    expect(result.healthy).toBe(true)
    expect(result.level).toBe('healthy')
    expect(result.category).toBe('general')
    expect(result.canFix).toBe(false)
  })

  it('does not offer doctor fix for known manual-only warnings', () => {
    const result = parseOpenClawDoctorOutput(`
◇  Doctor warnings
- Skipped Memory Core short-term recall import for /Users/doctor/.openclaw/workspace because SQLite rows already exist; left legacy source in place
◇  State integrity
- OAuth dir not present (~/.openclaw/credentials). Skipping create because no WhatsApp/pairing channel config is active.
- Found 1 agent directory on disk without a matching agents.list entry.
◇  Security
- WARNING: openclaw.json contains plaintext secret-bearing config fields.
Run "openclaw doctor --fix" to apply changes.
`, 0)

    expect(result.healthy).toBe(false)
    expect(result.level).toBe('warning')
    expect(result.canFix).toBe(false)
  })

  it('treats boxed manual-only output with Errors: 0 as a non-fixable warning', () => {
    const result = parseOpenClawDoctorOutput(`
┌  OpenClaw doctor
│
◇  Doctor warnings ────────────────────────────────────────────────────────╮
│  - Skipped Memory Core short-term recall import for                      │
│    /Users/doctor/.openclaw/workspace because SQLite rows already exist;  │
│    left legacy source in place                                           │
├──────────────────────────────────────────────────────────────────────────╯
◇  Doctor info ────────────────────────────────────────────────────────────╮
│  - Personal Codex CLI assets were found, but native Codex-mode OpenClaw  │
│  - Sources: /Users/doctor/.codex and /Users/doctor/.agents/skills (0     │
├──────────────────────────────────────────────────────────────────────────╯
◇  Legacy state detected ─────────────────────────────────────────────────╮
│  - Memory Core short-term recall:                                       │
├──────────────────────────────────────────────────────────────────────────╯
◇  State integrity ──────────────────────────────────────────────────────╮
│  - OAuth dir not present (~/.openclaw/credentials). Skipping create    │
│  - Found 1 agent directory on disk without a matching agents.list      │
├────────────────────────────────────────────────────────────────────────╯
◇  Security ─────────────────────────────────────────────────────────────╮
│  - WARNING: openclaw.json contains plaintext secret-bearing config     │
│  - Run: openclaw security audit --deep                                 │
├────────────────────────────────────────────────────────────────────────╯
◇  Plugins ──────╮
│  Errors: 0     │
├────────────────╯
Run "openclaw doctor --fix" to apply changes.
`, 0)

    expect(result.healthy).toBe(false)
    expect(result.level).toBe('warning')
    expect(result.canFix).toBe(false)
    expect(result.summary).toBe(
      'Skipped Memory Core short-term recall import for /Users/doctor/.openclaw/workspace because SQLite rows already exist; left legacy source in place'
    )
    expect(result.issues).toEqual(expect.arrayContaining([
      'Memory Core short-term recall:',
      'OAuth dir not present (~/.openclaw/credentials). Skipping create',
      'Found 1 agent directory on disk without a matching agents.list',
      'WARNING: openclaw.json contains plaintext secret-bearing config',
    ]))
    expect(result.issues).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('Personal Codex CLI assets'),
        expect.stringContaining('Sources:'),
      ])
    )
  })

  it('does not offer doctor fix for sandbox MCP allowlist warnings', () => {
    const result = parseOpenClawDoctorOutput(`
◇  Doctor warnings
- mcp.servers defines 2 MCP servers ("obsidian", "playwright"), but tools.sandbox.tools.alsoAllow (unset) does not include "bundle-mcp", "group:plugins", or a matching server-prefixed MCP tool name/glob such as "<server>__*". Sandboxed agents will filter bundled MCP tools before provider requests.
Run "openclaw doctor --fix" to apply changes.
`, 0)

    expect(result.healthy).toBe(false)
    expect(result.level).toBe('warning')
    expect(result.canFix).toBe(false)
    expect(result.summary).toContain('mcp.servers defines 2 MCP servers')
  })

  it('treats positive security lines as healthy, not warnings (#331)', () => {
    const result = parseOpenClawDoctorOutput(`
? Security
- No channel security warnings detected.
- Run: openclaw security audit --deep
`, 0)

    expect(result.healthy).toBe(true)
    expect(result.level).toBe('healthy')
    expect(result.issues).toEqual([])
  })

  it('still detects real security warnings alongside positive lines', () => {
    const result = parseOpenClawDoctorOutput(`
? Security
- Channel "public" has no auth configured.
- No channel security warnings detected.
- Run: openclaw security audit --deep
`, 0)

    expect(result.healthy).toBe(false)
    expect(result.level).toBe('warning')
    expect(result.issues).toEqual([
      'Channel "public" has no auth configured.',
    ])
  })
})
