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
    expect(result.category).toBe('security')
    expect(result.issues).toEqual([
      'Channel "public" has no auth configured.',
    ])
  })

  it('suppresses active non-stale locks plus expected companion-service notes into healthy status', () => {
    const result = parseOpenClawDoctorOutput(`
┌  OpenClaw doctor
│
◇  Session locks
│  - Found 1 session lock file.
│  - ~/.openclaw/agents/main/sessions/157ac21b-beed-4c64-862e-14247e572a4d.jsonl.lock
│    pid=103378 (alive) age=45s stale=no
│
◇  Other gateway-like services detected
│  - mission-control.service (user, unit: /home/jeffrey4341/.config/systemd/user/mission-control.service)
│
◇  Cleanup hints
│  - systemctl --user disable --now openclaw-gateway.service
│  - rm ~/.config/systemd/user/openclaw-gateway.service
│
◇  Security
│  - Note: approvals.exec.enabled=false disables approval forwarding only.
│  - WhatsApp DMs: locked (channels.whatsapp.accounts.default.dmPolicy="pairing") with no allowlist; unknown senders will be blocked / get a pairing code.
│
◇  Plugins
│  Loaded: 4
│  Disabled: 37
│  Errors: 0
Run "openclaw doctor --fix" to apply changes.
`, 0)

    expect(result.healthy).toBe(true)
    expect(result.level).toBe('healthy')
    expect(result.category).toBe('general')
    expect(result.summary).toBe('OpenClaw doctor reports a healthy configuration.')
    expect(result.issues).toEqual([])
    expect(result.canFix).toBe(false)
  })

  it('keeps stale or dead session locks as state warnings', () => {
    const result = parseOpenClawDoctorOutput(`
◇  Session locks
- Found 1 session lock file.
- ~/.openclaw/agents/main/sessions/stale.lock
  pid=123 (dead) age=2h14m stale=yes (dead-pid)
Run "openclaw doctor --fix" to apply changes.
`, 0)

    expect(result.healthy).toBe(false)
    expect(result.level).toBe('warning')
    expect(result.category).toBe('state')
    expect(result.summary).toBe('Found 1 session lock file.')
    expect(result.issues).toContain('Found 1 session lock file.')
    expect(result.canFix).toBe(true)
  })
})
