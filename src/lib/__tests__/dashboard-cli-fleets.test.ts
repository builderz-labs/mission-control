import { describe, expect, it } from 'vitest'
import { CLI_SESSION_KINDS, isForeignPrefixedSessionId } from '../cli-session-kinds'
import { buildCliFleets, filterSessionsByKind, groupSessionsByKind } from '../dashboard-cli-fleets'
import { parseSessionLimit, takeBalancedSessions } from '../session-list-balance'
import { resolveDashboardLayout, LOCAL_DEFAULT_LAYOUT } from '../dashboard-widgets'
import { localSessionLogs, mergeRecentLogs, sessionLogSource } from '../dashboard-session-logs'

function session(kind: string, id: string, extra: Record<string, unknown> = {}) {
  return { id, kind, active: false, ...extra }
}

describe('foreign prefixed session ids', () => {
  it('keeps real Claude ids and drops other CLI prefixes copied into claude_sessions', () => {
    expect(isForeignPrefixedSessionId('345811f4-7b79-4dc2-a135-e02b7282ccba')).toBe(false)
    expect(isForeignPrefixedSessionId('grok:01a06eef-8e36-73d1-8a96-ddb4856e948e')).toBe(true)
    expect(isForeignPrefixedSessionId('codex:01a06dc5-b5d5-7060-ae26-8ef29a6cda1c')).toBe(true)
    expect(isForeignPrefixedSessionId('kimi:abc')).toBe(true)
  })
})

describe('cli fleets', () => {
  it('includes every CLI engine even when some have no sessions', () => {
    const fleets = buildCliFleets([
      session('grok', 'g1', { active: true }),
      session('kimi', 'k1'),
    ])
    expect(fleets.map((fleet) => fleet.kind)).toEqual([...CLI_SESSION_KINDS])
    const grok = fleets.find((fleet) => fleet.kind === 'grok')
    expect(grok).toMatchObject({ active: 1, total: 1, label: 'Grok' })
    expect(fleets.find((fleet) => fleet.kind === 'claude-code')?.total).toBe(0)
  })

  it('groups leftover kinds as gateway', () => {
    const fleets = buildCliFleets([session('unknown', 'u1'), session('gateway', 'gw1')])
    const gateway = fleets.find((fleet) => fleet.kind === 'gateway')
    expect(gateway?.total).toBe(2)
  })

  it('filters by active and kind', () => {
    const sessions = [
      session('grok', 'g1', { active: true }),
      session('grok', 'g2'),
      session('kimi', 'k1', { active: true }),
    ]
    expect(filterSessionsByKind(sessions, 'active').map((row) => row.id)).toEqual(['g1', 'k1'])
    expect(filterSessionsByKind(sessions, 'grok')).toHaveLength(2)
    expect(groupSessionsByKind(sessions).get('grok')).toHaveLength(2)
  })
})

describe('session list balance', () => {
  it('parses all as the absolute cap', () => {
    expect(parseSessionLimit('all')).toBe(2000)
    expect(parseSessionLimit('12')).toBe(12)
    expect(parseSessionLimit('nope')).toBe(120)
  })

  it('reserves slots for hermes and opencode, not only chat tree engines', () => {
    const sessions = [
      ...Array.from({ length: 80 }, (_, i) => ({ id: `c${i}`, kind: 'codex-cli', source: 'local', lastActivity: 1000 + i })),
      { id: 'h1', kind: 'hermes', source: 'local', lastActivity: 9 },
      { id: 'o1', kind: 'opencode', source: 'local', lastActivity: 8 },
      { id: 'g1', kind: 'grok', source: 'local', lastActivity: 10 },
    ]
    const picked = takeBalancedSessions(sessions, 40)
    const kinds = new Set(picked.map((row) => row.kind))
    expect(kinds.has('hermes')).toBe(true)
    expect(kinds.has('opencode')).toBe(true)
    expect(kinds.has('grok')).toBe(true)
    expect(picked.length).toBeLessThanOrEqual(40)
  })
})

describe('dashboard layout', () => {
  it('leads the default overview with the session terminal, then the workbench', () => {
    expect(LOCAL_DEFAULT_LAYOUT[1]).toBe('session-terminal')
    expect(LOCAL_DEFAULT_LAYOUT[2]).toBe('session-workbench')
  })

  it('upgrades any previous default layout to include the current CLI widgets', () => {
    const oldest = ['briefing-bar', 'activity-timeline', 'fleet-status', 'task-pipeline', 'system-health', 'quick-actions']
    const withWorkbench = ['briefing-bar', 'session-workbench', ...oldest.slice(1)]
    expect(resolveDashboardLayout(oldest, 'local')).toEqual(LOCAL_DEFAULT_LAYOUT)
    expect(resolveDashboardLayout(withWorkbench, 'local')).toEqual(LOCAL_DEFAULT_LAYOUT)
    expect(resolveDashboardLayout(['briefing-bar', 'metric-cards'], 'local')).toEqual(['briefing-bar', 'metric-cards'])
  })
})

describe('session logs', () => {
  it('tags grok and kimi sources instead of collapsing them to claude', () => {
    expect(sessionLogSource('grok')).toBe('grok-local')
    expect(sessionLogSource('kimi')).toBe('kimi-local')
    expect(sessionLogSource('opencode')).toBe('opencode-local')
    const logs = localSessionLogs([
      { id: 'g1', kind: 'grok', lastActivity: 50, lastUserPrompt: 'ship it', active: true },
    ])
    expect(logs[0]).toMatchObject({ source: 'grok-local', message: 'Prompt: ship it' })
    expect(mergeRecentLogs(logs, logs)).toHaveLength(1)
  })
})
