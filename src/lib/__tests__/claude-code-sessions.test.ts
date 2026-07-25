import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'

// The session manager reads through getDatabase() and audits through
// logAuditEvent; route both at a per-test in-memory database so behavior is
// tested end to end without touching the config-resolved database file.
const state = vi.hoisted(() => ({
  db: null as unknown,
  auditEvents: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: () => state.db,
  logAuditEvent: (event: Record<string, unknown>) => { state.auditEvents.push(event) },
}))

import {
  assertSessionOwnedByAgent,
  ensureClaudeBaseSession,
  isValidClaudeSessionId,
  markClaudeBaseSessionMaterialized,
  rotateClaudeBaseSession,
} from '@/lib/claude-code-sessions'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let db: InstanceType<typeof Database>

function insertAgent(name: string): number {
  return Number(db.prepare("INSERT INTO agents (name, role, workspace_id) VALUES (?, 'agent', 1)").run(name).lastInsertRowid)
}

function agentRow(id: number) {
  return db.prepare('SELECT claude_base_session_id, claude_base_session_created_at FROM agents WHERE id = ?').get(id) as {
    claude_base_session_id: string | null
    claude_base_session_created_at: string | null
  }
}

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  state.db = db
  state.auditEvents = []
})

afterEach(() => db.close())

describe('migration 055_agent_claude_base_session', () => {
  it('adds nullable base-session columns and replays idempotently', () => {
    const cols = (db.pragma('table_info(agents)') as Array<{ name: string }>).map(c => c.name)
    expect(cols).toContain('claude_base_session_id')
    expect(cols).toContain('claude_base_session_created_at')

    db.prepare("DELETE FROM schema_migrations WHERE id = '055_agent_claude_base_session'").run()
    expect(() => runMigrations(db)).not.toThrow()
  })
})

describe('ensureClaudeBaseSession', () => {
  it('lazily claims a server-generated UUID and audits base creation once', () => {
    const agentId = insertAgent('claude-worker')
    const first = ensureClaudeBaseSession(agentId)

    expect(first.sessionId).toMatch(UUID_RE)
    expect(first.materialized).toBe(false)
    expect(agentRow(agentId).claude_base_session_id).toBe(first.sessionId)

    const second = ensureClaudeBaseSession(agentId)
    expect(second.sessionId).toBe(first.sessionId)

    const created = state.auditEvents.filter(e => e.action === 'claude_session.base_created')
    expect(created).toHaveLength(1)
    expect(created[0].target_id).toBe(agentId)
  })

  it('refuses a hand-edited non-UUID base id instead of regenerating it', () => {
    const agentId = insertAgent('tampered')
    db.prepare("UPDATE agents SET claude_base_session_id = 'not-a-uuid' WHERE id = ?").run(agentId)
    expect(() => ensureClaudeBaseSession(agentId)).toThrow(/non-UUID/)
  })

  it('throws for an unknown agent', () => {
    expect(() => ensureClaudeBaseSession(99999)).toThrow(/not found/)
  })
})

describe('markClaudeBaseSessionMaterialized', () => {
  it('stamps once and only for the matching session id', () => {
    const agentId = insertAgent('stamper')
    const { sessionId } = ensureClaudeBaseSession(agentId)

    markClaudeBaseSessionMaterialized(agentId, '11111111-2222-4333-8444-555555555555')
    expect(agentRow(agentId).claude_base_session_created_at).toBeNull()

    markClaudeBaseSessionMaterialized(agentId, sessionId)
    const stamped = agentRow(agentId).claude_base_session_created_at
    expect(stamped).not.toBeNull()

    markClaudeBaseSessionMaterialized(agentId, sessionId)
    expect(agentRow(agentId).claude_base_session_created_at).toBe(stamped)

    expect(ensureClaudeBaseSession(agentId).materialized).toBe(true)
  })
})

describe('assertSessionOwnedByAgent', () => {
  it('rejects invalid ids, foreign sessions, and cross-agent reuse', () => {
    const a = insertAgent('owner-a')
    const b = insertAgent('owner-b')
    const sessionA = ensureClaudeBaseSession(a).sessionId

    expect(() => assertSessionOwnedByAgent(a, 'not-a-uuid')).toThrow(/invalid/)
    expect(() => assertSessionOwnedByAgent(a, '99999999-9999-4999-8999-999999999999')).toThrow(/not owned/)
    expect(() => assertSessionOwnedByAgent(b, sessionA)).toThrow(/not owned/)
    expect(() => assertSessionOwnedByAgent(a, sessionA)).not.toThrow()
  })
})

describe('rotateClaudeBaseSession', () => {
  it('clears the base session, audits with the previous id, and allows a fresh claim', () => {
    const agentId = insertAgent('rotator')
    const { sessionId } = ensureClaudeBaseSession(agentId)
    markClaudeBaseSessionMaterialized(agentId, sessionId)

    rotateClaudeBaseSession(agentId, 'operator', 'runtime_type changed away from claude')
    expect(agentRow(agentId)).toEqual({ claude_base_session_id: null, claude_base_session_created_at: null })

    const rotated = state.auditEvents.filter(e => e.action === 'claude_session.rotated')
    expect(rotated).toHaveLength(1)
    expect((rotated[0].detail as Record<string, unknown>).previous_base_session_id).toBe(sessionId)

    const fresh = ensureClaudeBaseSession(agentId)
    expect(fresh.sessionId).not.toBe(sessionId)
    expect(fresh.materialized).toBe(false)
  })

  it('is a no-op without a base session', () => {
    const agentId = insertAgent('nothing-to-rotate')
    rotateClaudeBaseSession(agentId, 'operator', 'noop')
    expect(state.auditEvents.filter(e => e.action === 'claude_session.rotated')).toHaveLength(0)
  })
})

describe('audit hygiene', () => {
  it('never records prompt or soul contents', () => {
    const agentId = insertAgent('hygiene')
    const { sessionId } = ensureClaudeBaseSession(agentId)
    rotateClaudeBaseSession(agentId, 'operator', 'hygiene check')
    const serialized = JSON.stringify(state.auditEvents)
    expect(serialized).toContain(sessionId)
    expect(serialized).not.toMatch(/prompt|soul_content/i)
  })
})

describe('isValidClaudeSessionId', () => {
  it('accepts UUIDs and rejects everything else', () => {
    expect(isValidClaudeSessionId('11111111-2222-4333-8444-555555555555')).toBe(true)
    expect(isValidClaudeSessionId('gggggggg-2222-4333-8444-555555555555')).toBe(false)
    expect(isValidClaudeSessionId('')).toBe(false)
    expect(isValidClaudeSessionId(null)).toBe(false)
    expect(isValidClaudeSessionId('11111111222243338444555555555555')).toBe(false)
  })
})
