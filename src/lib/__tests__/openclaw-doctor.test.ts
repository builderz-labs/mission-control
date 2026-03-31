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
    expect(result.issues).toEqual([
      'Channel "public" has no auth configured.',
    ])
  })

  it('ignores informational launchd discovery and cleanup hint bullets', () => {
    const result = parseOpenClawDoctorOutput(`
◇  Other gateway-like services detected
- ai.openclaw.daily-us-stock-news (user, plist: /Users/j2w/Library/LaunchAgents/ai.openclaw.daily-us-stock-news.plist)
- ai.openclaw.mission-control (user, plist: /Users/j2w/Library/LaunchAgents/ai.openclaw.mission-control.plist)
◇  Cleanup hints
- launchctl bootout gui/$UID/ai.openclaw.gateway
- rm ~/Library/LaunchAgents/ai.openclaw.gateway.plist
`, 0)

    expect(result.healthy).toBe(true)
    expect(result.level).toBe('healthy')
    expect(result.issues).toEqual([])
  })

  it('treats CRITICAL findings as errors even when exit code is zero', () => {
    const result = parseOpenClawDoctorOutput(`
◇  State integrity
- CRITICAL: Session store dir missing ($OPENCLAW_HOME/.openclaw/agents/main/sessions).
`, 0)

    expect(result.healthy).toBe(false)
    expect(result.level).toBe('error')
    expect(result.issues).toEqual([
      'CRITICAL: Session store dir missing ($OPENCLAW_HOME/.openclaw/agents/main/sessions).',
    ])
  })

  it('ignores operator guidance and housekeeping-only warnings', () => {
    const result = parseOpenClawDoctorOutput(`
◇  Doctor warnings
- channels.telegram: Telegram is in first-time setup mode. DMs use pairing mode.
- Found 239 orphan transcript files in ~/.openclaw/agents/main/sessions.
- Chrome MCP existing-session is configured for profile(s): user.
- Enable remote debugging in the browser inspect page.
- WARN codex-bridge-command: loaded without install/load-path provenance.
- Set OPENAI_API_KEY, GEMINI_API_KEY, VOYAGE_API_KEY, or MISTRAL_API_KEY in your environment
Run "openclaw doctor --fix" to apply changes.
`, 0)

    expect(result.healthy).toBe(true)
    expect(result.level).toBe('healthy')
    expect(result.issues).toEqual([])
  })

  it('treats gateway token reinstall hints as advisory under the current operating profile', () => {
    const result = parseOpenClawDoctorOutput(`
◇  Gateway service config
- Gateway service embeds OPENCLAW_GATEWAY_TOKEN and should be reinstalled.
◇  Memory search
- Set OPENAI_API_KEY, GEMINI_API_KEY, VOYAGE_API_KEY, or MISTRAL_API_KEY in your environment
- To disable: openclaw config set agents.defaults.memorySearch.enabled false
- Verify: openclaw memory status --deep
Run "openclaw doctor --fix" to apply changes.
`, 0)

    expect(result.healthy).toBe(true)
    expect(result.level).toBe('healthy')
    expect(result.canFix).toBe(false)
    expect(result.issues).toEqual([])
  })

  it('does not advertise a doctor fix action for non-fixable warnings', () => {
    const result = parseOpenClawDoctorOutput(`
◇  Memory search
- Set OPENAI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, VOYAGE_API_KEY, or MISTRAL_API_KEY in your environment
`, 0)

    expect(result.healthy).toBe(false)
    expect(result.level).toBe('warning')
    expect(result.canFix).toBe(false)
  })

  it('ignores wrapped first-line operator guidance fragments from boxed output', () => {
    const result = parseOpenClawDoctorOutput(`
◇  Doctor warnings
- Found 239 orphan transcript files in
- WARN codex-bridge-command: loaded without install/load-path
- Set OPENAI_API_KEY, GEMINI_API_KEY, VOYAGE_API_KEY, or
◇  Gateway service config
- Gateway service embeds OPENCLAW_GATEWAY_TOKEN and should be reinstalled.
`, 0)

    expect(result.healthy).toBe(true)
    expect(result.level).toBe('healthy')
    expect(result.issues).toEqual([])
  })

  it('ignores wrapped advisory fragments that are split mid-sentence by boxed output', () => {
    const result = parseOpenClawDoctorOutput(`
◇  Gateway service config
- Gateway service embeds OPENCLAW_GATEWAY_TOKEN and should be
  reinstalled.
◇  Memory search
- Set OPENAI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, VOYAGE_API_KEY,
  or MISTRAL_API_KEY in your environment
`, 0)

    expect(result.healthy).toBe(true)
    expect(result.level).toBe('healthy')
    expect(result.issues).toEqual([])
  })

  it('ignores active session lock housekeeping lines', () => {
    const result = parseOpenClawDoctorOutput(`
◇  Session locks
- Found 1 session lock file.
- ~/.openclaw/agents/main/sessions/abc.jsonl.lock pid=123 (alive) age=13s stale=no
`, 0)

    expect(result.healthy).toBe(true)
    expect(result.level).toBe('healthy')
    expect(result.issues).toEqual([])
  })

  it('treats advisory-only doctor output wrapped in a command failure envelope as healthy', () => {
    const result = parseOpenClawDoctorOutput(`
▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
┌  OpenClaw doctor
│
◇  Doctor warnings
│  - channels.telegram: Telegram is in first-time setup mode. DMs use pairing mode.
◇  State integrity
│  - Found 239 orphan transcript files in $OPENCLAW_HOME/agents/main/sessions.
◇  Plugin diagnostics
│  - WARN codex-bridge-command: loaded without install/load-path provenance.
◇  Memory search
│  - Set OPENAI_API_KEY, GEMINI_API_KEY, VOYAGE_API_KEY, or MISTRAL_API_KEY in your environment
Run "openclaw doctor --fix" to apply changes.
└  Doctor complete.

[plugins] codex-bridge-command: loaded without install/load-path provenance
[skills] Skipping skill path that resolves outside its configured root.

Command failed (openclaw doctor): [plugins] codex-bridge-command: loaded without install/load-path provenance
`, 1)

    expect(result.healthy).toBe(true)
    expect(result.level).toBe('healthy')
    expect(result.summary).toContain('no blocking issues')
    expect(result.issues).toEqual([])
  })

  it('keeps advisory-only boxed output healthy even when summary tables contain "Errors: 0"', () => {
    const result = parseOpenClawDoctorOutput(`
◇  Gateway service config
- Gateway service embeds OPENCLAW_GATEWAY_TOKEN and should be reinstalled.
◇  Plugins
Loaded: 40
Disabled: 44
Errors: 0
◇  Memory search
- Set OPENAI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, VOYAGE_API_KEY,
  MISTRAL_API_KEY in your environment
Run "openclaw doctor --fix" to apply changes.
`, 0)

    expect(result.healthy).toBe(true)
    expect(result.level).toBe('healthy')
    expect(result.summary).toContain('no blocking issues')
    expect(result.issues).toEqual([])
  })
})
