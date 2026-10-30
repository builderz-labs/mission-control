import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'

// Same harness as the Claude base-session tests: reads and audits go to a
// per-test in-memory database so the capture-once behaviour is observable.
const state = vi.hoisted(() => ({
  db: null as unknown,
  auditEvents: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: () => state.db,
  logAuditEvent: (event: Record<string, unknown>) => { state.auditEvents.push(event) },
}))

import {
  auditZcodeSessionDispatch,
  getZcodeBaseSession,
  rotateZcodeBaseSession,
  saveZcodeBaseSession,
} from '@/lib/zcode-agent-sessions'

const SESSION = 'sess_33333333-3333-4333-8333-333333333333'
const OTHER = 'sess_44444444-4444-4444-8444-444444444444'

let db: InstanceType<typeof Database>

function insertAgent(name: string): number {
  return Number(db.prepare("INSERT INTO agents (name, role, workspace_id) VALUES (?, 'agent', 1)").run(name).lastInsertRowid)
}

function baseSession(id: number): string | null {
  return (db.prepare('SELECT zcode_base_session_id FROM agents WHERE id = ?').get(id) as {
    zcode_base_session_id: string | null
  }).zcode_base_session_id
}

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  state.db = db
  state.auditEvents = []
})

afterEach(() => db.close())

describe('migration 056_agent_zcode_base_session', () => {
  it('adds the nullable base-session column and replays idempotently', () => {
    const cols = (db.pragma('table_info(agents)') as Array<{ name: string }>).map((c) => c.name)
    expect(cols).toContain('zcode_base_session_id')

    db.prepare("DELETE FROM schema_migrations WHERE id = '056_agent_zcode_base_session'").run()
    expect(() => runMigrations(db)).not.toThrow()
  })
})

describe('saveZcodeBaseSession', () => {
  it('captures the id the CLI minted and audits it once', () => {
    const agentId = insertAgent('zcode-capture')
    expect(getZcodeBaseSession(agentId)).toBeNull()

    expect(saveZcodeBaseSession(agentId, SESSION)).toBe(true)
    expect(baseSession(agentId)).toBe(SESSION)
    expect(getZcodeBaseSession(agentId)).toBe(SESSION)
    expect(state.auditEvents.filter((e) => e.action === 'zcode_session.base_saved')).toHaveLength(1)
  })

  it('keeps the first session when a later dispatch reports a different id', () => {
    const agentId = insertAgent('zcode-sticky')
    saveZcodeBaseSession(agentId, SESSION)
    expect(saveZcodeBaseSession(agentId, OTHER)).toBe(false)
    expect(baseSession(agentId)).toBe(SESSION)
  })

  it('refuses an id ZCode would never have produced', () => {
    const agentId = insertAgent('zcode-invalid')
    expect(saveZcodeBaseSession(agentId, 'claude-style-uuid-9a3c')).toBe(false)
    expect(baseSession(agentId)).toBeNull()
  })

  it('throws for an unknown agent', () => {
    expect(() => getZcodeBaseSession(9999)).toThrow(/not found/)
  })
})

describe('rotateZcodeBaseSession', () => {
  it('clears the base session, audits the previous id, and allows a fresh capture', () => {
    const agentId = insertAgent('zcode-rotate')
    saveZcodeBaseSession(agentId, SESSION)

    rotateZcodeBaseSession(agentId, 'tester', 'runtime_type changed away from zcode')
    expect(baseSession(agentId)).toBeNull()
    const rotation = state.auditEvents.find((e) => e.action === 'zcode_session.rotated') as { detail: Record<string, unknown> }
    expect(rotation.detail).toMatchObject({
      previous_base_session_id: SESSION,
      reason: 'runtime_type changed away from zcode',
    })

    expect(saveZcodeBaseSession(agentId, OTHER)).toBe(true)
  })

  it('is a no-op without a base session', () => {
    const agentId = insertAgent('zcode-empty')
    rotateZcodeBaseSession(agentId, 'tester', 'nothing to retire')
    expect(state.auditEvents).toHaveLength(0)
  })
})

describe('auditZcodeSessionDispatch', () => {
  it('records the outcome and session without prompt material', () => {
    const agentId = insertAgent('zcode-audit')
    auditZcodeSessionDispatch({ agentId, taskId: 12, outcome: 'resumed', sessionId: SESSION })
    auditZcodeSessionDispatch({ agentId, taskId: 12, outcome: 'failed', error: `boom ${'x'.repeat(500)}` })

    const [first, second] = state.auditEvents
    expect(first).toMatchObject({ action: 'zcode_session.resumed', target_id: agentId })
    expect((first as { detail: unknown }).detail).toMatchObject({ task_id: 12, session_id: SESSION })
    const detail = (second as { detail: { error: string } }).detail
    expect(second).toMatchObject({ action: 'zcode_session.failed' })
    expect(detail.error).toHaveLength(300)
    expect(JSON.stringify(detail)).not.toMatch(/soul|prompt/i)
  })
})
