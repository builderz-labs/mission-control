import { describe, expect, it } from 'vitest'
import { dedupeAndSortSessions, takeBalancedSessions } from '../session-list-balance'

describe('takeBalancedSessions', () => {
  it('reserves recent slots for each CLI engine', () => {
    const sessions = [
      ...Array.from({ length: 80 }, (_, i) => ({ id: `c${i}`, kind: 'codex-cli', source: 'local', lastActivity: 1000 + i })),
      { id: 'g1', kind: 'grok', source: 'local', lastActivity: 10 },
      { id: 'k1', kind: 'kimi', source: 'local', lastActivity: 11 },
      { id: 'cl1', kind: 'claude-code', source: 'local', lastActivity: 12 },
      { id: 'h1', kind: 'hermes', source: 'local', lastActivity: 13 },
      { id: 'o1', kind: 'opencode', source: 'local', lastActivity: 14 },
    ]
    const picked = takeBalancedSessions(sessions, 40)
    const kinds = new Set(picked.map((session) => session.kind))
    expect(kinds.has('grok')).toBe(true)
    expect(kinds.has('kimi')).toBe(true)
    expect(kinds.has('claude-code')).toBe(true)
    expect(kinds.has('codex-cli')).toBe(true)
    expect(kinds.has('hermes')).toBe(true)
    expect(kinds.has('opencode')).toBe(true)
    expect(picked.length).toBeLessThanOrEqual(40)
  })

  it('keeps the newer duplicate and sorts by lastActivity', () => {
    const merged = dedupeAndSortSessions([
      { id: 'a', source: 'local', kind: 'grok', lastActivity: 10 },
      { id: 'a', source: 'local', kind: 'grok', lastActivity: 50 },
      { id: 'b', source: 'local', kind: 'kimi', lastActivity: 40 },
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ id: 'a', lastActivity: 50 })
    expect(merged[1]).toMatchObject({ id: 'b' })
  })
})
