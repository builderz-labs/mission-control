import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import { jevSetupSessionMigration } from '@/lib/jev-setup-session-migration'
import { createJevSetupSessionWithInput } from '@/lib/jev-setup-session-create'
import { createJevSetupSessionSchema } from '@/lib/jev-setup-session-validation'
import {
  appendJevSetupExchange,
  archiveJevSetupSession,
  createJevSetupSession,
  getJevSetupSession,
  getLatestJevSetupRevision,
  listJevSetupMessages,
  listJevSetupSessions,
} from '@/lib/jev-setup-session-repository'

let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  jevSetupSessionMigration.up(db)
  db.prepare(`
    INSERT INTO users (id,username,display_name,password_hash,role,workspace_id)
    VALUES (301,'owner','Owner','unused','operator',1)
  `).run()
  db.prepare(`
    INSERT INTO projects (id,workspace_id,name,slug,ticket_prefix)
    VALUES (391,1,'Owned','owned','OWN')
  `).run()
})

afterEach(() => db.close())

function createSession() {
  return createJevSetupSession({
    projectId: 391,
    title: 'Setup token=secret-value-123',
    provider: 'claude-cli',
    model: 'haiku',
  }, { workspaceId: 1, tenantId: 1, userId: 301 }, db)
}

describe('Jev setup-session migration and repository', () => {
  it('saves the full redacted goal and choices before any assistant response', () => {
    const input = createJevSetupSessionSchema.parse({ projectId: 391, title: 'Short title', initialInput: {
      goal: `${'Review accessibility and testing. '.repeat(10)} token=secret-value-123`,
      answers: { context: 'paste', enforcement: 'advisory' }, projectIds: [391],
    } })
    const session = createJevSetupSessionWithInput(input, { workspaceId: 1, tenantId: 1, userId: 301 }, db)
    const messages = listJevSetupMessages(session, 10, 0, db)
    expect(messages).toHaveLength(1)
    const saved = JSON.parse(messages[0].content)
    expect(saved.goal.length).toBeGreaterThan(120)
    expect(saved.goal).not.toContain('secret-value-123')
    expect(saved.answers.context).toBe('paste')
    expect(getLatestJevSetupRevision(session, db)).toBeNull()
  })

  it('rejects unauthorized or inconsistent initial repository scope without partial writes', () => {
    const base = { projectId: 391, title: 'Short title', provider: 'claude-cli', model: 'haiku' }
    for (const projectIds of [[391, 99999], [99999]]) {
      expect(() => createJevSetupSessionWithInput({ ...base, initialInput: {
        goal: 'Review accessibility', answers: {}, projectIds,
      } }, { workspaceId: 1, tenantId: 1, userId: 301 }, db)).toThrow()
    }
    expect(listJevSetupSessions(1, 1, {}, db)).toEqual([])
  })

  it('is idempotent and enforces ordered-message and status constraints', () => {
    jevSetupSessionMigration.up(db)
    const session = createSession()
    expect(session.title).not.toContain('secret-value-123')
    expect(() => db.prepare(`
      INSERT INTO jev_setup_messages (workspace_id,session_id,ordinal,role,content)
      VALUES (1,?,0,'user','{}')
    `).run(session.id)).toThrow()
    expect(() => db.prepare(`
      UPDATE jev_setup_sessions SET status='invalid' WHERE id=?
    `).run(session.id)).toThrow()
  })

  it('persists redacted exchanges, provider metadata, and ordered revisions', () => {
    const session = createSession()
    const first = appendJevSetupExchange(session, {
      user: { goal: 'Use Bearer abcdefghijklmnop', password: 'password=hunter2' },
      assistant: { summary: 'Draft with sk-abcdefghijklmnop' },
      draft: { summary: 'Ready', apiKey: 'api_key=raw-secret-value' },
      configuration: { scope: 'current' },
      provider: 'claude-cli',
      model: 'haiku',
    }, db)
    const second = appendJevSetupExchange(session, {
      user: { revision: 'Make it strict' }, assistant: { summary: 'Revised' },
      draft: { summary: 'Revised' }, configuration: { scope: 'current' },
      provider: 'claude-cli', model: 'sonnet',
    }, db)

    expect(first.revision_no).toBe(1)
    expect(second.revision_no).toBe(2)
    const messages = listJevSetupMessages(session, 10, 0, db)
    expect(messages.map((message) => message.ordinal)).toEqual([1, 2, 3, 4])
    expect(JSON.stringify(messages)).not.toMatch(/hunter2|abcdefghijklmnop|raw-secret-value/)
    expect(getLatestJevSetupRevision(session, db)).toMatchObject({
      revision_no: 2, provider: 'claude-cli', model: 'sonnet',
    })
  })

  it('fails closed across workspace and tenant scope and archives softly', () => {
    const session = createSession()
    expect(() => getJevSetupSession(session.id, 1, 999, db)).toThrow('not found')
    expect(listJevSetupSessions(1, 999, {}, db)).toEqual([])
    const archived = archiveJevSetupSession(session, db)
    expect(archived.status).toBe('archived')
    expect(listJevSetupSessions(1, 1, {}, db)).toEqual([])
    expect(listJevSetupSessions(1, 1, { includeArchived: true }, db)).toHaveLength(1)
  })
})
