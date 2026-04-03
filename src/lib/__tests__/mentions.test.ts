import { describe, it, expect, vi } from 'vitest'
import { parseMentions, getMentionTargets, resolveMentionRecipients } from '../mentions'
import type { Database } from 'better-sqlite3'

describe('parseMentions', () => {
  it('returns empty array for empty input', () => {
    expect(parseMentions('')).toEqual([])
  })

  it('returns empty array for null/undefined-like input', () => {
    // @ts-expect-error testing non-string
    expect(parseMentions(null)).toEqual([])
    // @ts-expect-error testing non-string
    expect(parseMentions(undefined)).toEqual([])
  })

  it('extracts a single mention', () => {
    expect(parseMentions('hello @alice')).toEqual(['alice'])
  })

  it('extracts multiple mentions', () => {
    const result = parseMentions('hey @alice and @bob, please help')
    expect(result).toContain('alice')
    expect(result).toContain('bob')
    expect(result).toHaveLength(2)
  })

  it('deduplicates mentions', () => {
    const result = parseMentions('@alice again @alice')
    expect(result).toEqual(['alice'])
  })

  it('deduplication is case-insensitive', () => {
    const result = parseMentions('@Alice and @alice')
    expect(result).toHaveLength(1)
  })

  it('handles mention at start of string', () => {
    expect(parseMentions('@root please help')).toEqual(['root'])
  })

  it('handles mention with dots and hyphens', () => {
    expect(parseMentions('@john.doe')).toEqual(['john.doe'])
    expect(parseMentions('@my-agent')).toEqual(['my-agent'])
  })

  it('does not match email addresses (preceded by alphanumeric)', () => {
    // email@example.com — the @ is preceded by alphanumeric, should NOT match
    const result = parseMentions('send to user@example.com')
    expect(result).not.toContain('example.com')
  })

  it('handles text with no mentions', () => {
    expect(parseMentions('no mentions here')).toEqual([])
  })

  it('preserves original case of first occurrence', () => {
    const result = parseMentions('@Alice')
    expect(result[0]).toBe('Alice')
  })

  it('handles mixed content', () => {
    const result = parseMentions('Task for @alice: review @bob\'s PR')
    expect(result).toContain('alice')
    expect(result).toContain('bob')
  })
})

// ---------------------------------------------------------------------------
// Helper to build a mock Database for getMentionTargets / resolveMentionRecipients
// ---------------------------------------------------------------------------

function makeMockDb(
  users: Array<{ username: string; display_name?: string | null }> = [],
  agents: Array<{ name: string; role?: string | null; config?: string | null }> = [],
): Database {
  // db.prepare(sql).all(params) — distinguish user vs agent queries by SQL content
  const prepare = vi.fn().mockImplementation((sql: string) => {
    const all = sql.includes('display_name')
      ? vi.fn().mockReturnValue(users)
      : vi.fn().mockReturnValue(agents)
    return { all }
  })
  return { prepare } as unknown as Database
}

// ---------------------------------------------------------------------------
// getMentionTargets
// ---------------------------------------------------------------------------

describe('getMentionTargets', () => {
  it('returns empty array when DB has no users or agents', () => {
    const db = makeMockDb([], [])
    expect(getMentionTargets(db, 1)).toEqual([])
  })

  it('maps users to MentionTarget with type "user"', () => {
    const db = makeMockDb([{ username: 'alice', display_name: 'Alice W.' }])
    const targets = getMentionTargets(db, 1)
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      handle: 'alice',
      recipient: 'alice',
      type: 'user',
      display: 'Alice W.',
    })
  })

  it('falls back to username when display_name is null', () => {
    const db = makeMockDb([{ username: 'bob', display_name: null }])
    const targets = getMentionTargets(db, 1)
    expect(targets[0].display).toBe('bob')
  })

  it('lowercases handle for users', () => {
    const db = makeMockDb([{ username: 'Charlie', display_name: null }])
    const targets = getMentionTargets(db, 1)
    expect(targets[0].handle).toBe('charlie')
    expect(targets[0].recipient).toBe('Charlie')
  })

  it('deduplicates users with the same lowercase handle', () => {
    const db = makeMockDb([
      { username: 'alice', display_name: null },
      { username: 'alice', display_name: 'Duplicate' },
    ])
    const targets = getMentionTargets(db, 1)
    expect(targets).toHaveLength(1)
  })

  it('maps agents to MentionTarget with type "agent"', () => {
    const db = makeMockDb([], [{ name: 'Ultron', role: 'coordinator', config: null }])
    const targets = getMentionTargets(db, 1)
    // expects at least the normalised handle
    expect(targets.some(t => t.type === 'agent')).toBe(true)
    expect(targets.some(t => t.recipient === 'Ultron')).toBe(true)
  })

  it('uses openclawId from config as primary agent handle when present', () => {
    const config = JSON.stringify({ openclawId: 'ultron-v1' })
    const db = makeMockDb([], [{ name: 'Ultron', role: 'ai', config }])
    const targets = getMentionTargets(db, 1)
    expect(targets.some(t => t.handle === 'ultron-v1')).toBe(true)
  })

  it('ignores invalid JSON in agent config gracefully', () => {
    const db = makeMockDb([], [{ name: 'Bot', role: 'worker', config: '{invalid json' }])
    // Should not throw
    const targets = getMentionTargets(db, 1)
    expect(targets.some(t => t.recipient === 'Bot')).toBe(true)
  })

  it('normalises multi-word agent names with hyphens', () => {
    const db = makeMockDb([], [{ name: 'My Agent', role: 'worker', config: null }])
    const targets = getMentionTargets(db, 1)
    expect(targets.some(t => t.handle === 'my-agent')).toBe(true)
  })

  it('skips agents with empty name', () => {
    const db = makeMockDb([], [{ name: '   ', role: 'worker', config: null }])
    const targets = getMentionTargets(db, 1)
    expect(targets).toHaveLength(0)
  })

  it('skips users with empty username', () => {
    const db = makeMockDb([{ username: '  ', display_name: null }])
    const targets = getMentionTargets(db, 1)
    expect(targets).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// resolveMentionRecipients
// ---------------------------------------------------------------------------

describe('resolveMentionRecipients', () => {
  it('returns empty resolution when text has no mentions', () => {
    const db = makeMockDb([{ username: 'alice', display_name: null }])
    const result = resolveMentionRecipients('no mentions here', db, 1)
    expect(result).toEqual({ tokens: [], unresolved: [], recipients: [], resolved: [] })
  })

  it('resolves a known user mention', () => {
    const db = makeMockDb([{ username: 'alice', display_name: 'Alice' }])
    const result = resolveMentionRecipients('Hey @alice', db, 1)
    expect(result.recipients).toContain('alice')
    expect(result.unresolved).toHaveLength(0)
    expect(result.resolved[0].type).toBe('user')
  })

  it('marks unknown mention as unresolved', () => {
    const db = makeMockDb([], [])
    const result = resolveMentionRecipients('Hey @ghost', db, 1)
    expect(result.unresolved).toContain('ghost')
    expect(result.recipients).toHaveLength(0)
  })

  it('resolves multiple mentions in one message', () => {
    const db = makeMockDb(
      [{ username: 'alice', display_name: null }, { username: 'bob', display_name: null }],
    )
    const result = resolveMentionRecipients('@alice and @bob', db, 1)
    expect(result.recipients).toContain('alice')
    expect(result.recipients).toContain('bob')
    expect(result.unresolved).toHaveLength(0)
  })

  it('deduplicates recipients when same user mentioned twice', () => {
    const db = makeMockDb([{ username: 'alice', display_name: null }])
    const result = resolveMentionRecipients('@alice and @Alice', db, 1)
    // dedup is case-insensitive — only one recipient
    expect(result.recipients).toHaveLength(1)
  })

  it('resolves agent mention by normalised handle', () => {
    const db = makeMockDb([], [{ name: 'My Agent', role: 'worker', config: null }])
    const result = resolveMentionRecipients('task for @my-agent', db, 1)
    expect(result.recipients).toContain('My Agent')
    expect(result.unresolved).toHaveLength(0)
  })

  it('includes tokens array with original mention tokens', () => {
    const db = makeMockDb([{ username: 'alice', display_name: null }])
    const result = resolveMentionRecipients('@alice please', db, 1)
    expect(result.tokens).toContain('alice')
  })
})
