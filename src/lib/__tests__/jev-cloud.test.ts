// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import { jevSetupSessionMigration } from '@/lib/jev-setup-session-migration'
import { jevCloudMigration } from '@/lib/jev-cloud-migration'
import { getJevCloudStatus, startJevCloudSync, stopJevCloudSync, syncJevCloudOutbox } from '@/lib/jev-cloud-sync'
import { prepareJevCloudPayload, type JevCloudEvent } from '@/lib/jev-cloud-repository'
import { createJevSetupSession, appendJevSetupExchange } from '@/lib/jev-setup-session-repository'
import { hashJevCloudPayload } from '@/lib/jev-cloud-integrity'

let db: InstanceType<typeof Database>
vi.mock('@/lib/db', () => ({ getDatabase: () => db }))
beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  jevSetupSessionMigration.up(db)
  jevCloudMigration.up(db)
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,role,workspace_id)
    VALUES(301,'cloud-owner','Owner','unused','operator',1)`).run()
  db.prepare(`INSERT INTO projects(id,workspace_id,name,slug,ticket_prefix)
    VALUES(391,1,'Cloud','cloud','CLD')`).run()
  vi.stubEnv('MC_SUPABASE_URL', 'https://nivlxzlxnfsgashuomxb.supabase.co')
  vi.stubEnv('MC_SUPABASE_PROJECT_REF', 'nivlxzlxnfsgashuomxb')
  vi.stubEnv('MC_SUPABASE_SECRET_KEY', 'sb_secret_synthetic_for_testing')
})
afterEach(() => { if (db) { stopJevCloudSync(db); db.close() }; vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })
const events = () => db.prepare('SELECT * FROM jev_cloud_outbox ORDER BY sequence').all() as JevCloudEvent[]
function session() {
  return createJevSetupSession({ projectId: 391, title: 'Cloud setup', provider: 'claude-cli', model: 'haiku' },
    { workspaceId: 1, tenantId: 1, userId: 301 }, db)
}

describe('Jev transactional cloud outbox', () => {
  it('keeps its origin stable and rolls back queued events with failed mutations', () => {
    const origin = db.prepare('SELECT * FROM jev_cloud_origin').get()
    jevCloudMigration.up(db)
    expect(db.prepare('SELECT * FROM jev_cloud_origin').get()).toEqual(origin)
    expect(() => db.transaction(() => { session(); throw new Error('rollback') })()).toThrow('rollback')
    expect(events()).toHaveLength(0)
  })

  it('captures sessions, both messages, revisions, policy changes and evaluations atomically', () => {
    const created = session()
    appendJevSetupExchange(created, { user: { goal: 'Review' }, assistant: { summary: 'Ready' },
      draft: {}, configuration: {}, provider: 'claude-cli', model: 'haiku' }, db)
    db.prepare(`INSERT INTO jev_policies(workspace_id,project_id,name,questions,created_by)
      VALUES(1,391,'Review','{}','user')`).run()
    db.prepare(`INSERT INTO jev_evaluations(id,workspace_id,project_id,status,model_requested,questions,
      state_sha256,state_length,state_preview,created_by) VALUES('test-eval',1,391,'running','jev-latest','{}',
      'private-hash',14,'never-copy-raw','user')`).run()
    expect(new Set(events().map((event) => event.entity_type))).toEqual(new Set([
      'policies', 'evaluations', 'setup_sessions', 'setup_messages', 'setup_revisions',
    ]))
    const evaluation = events().find((event) => event.entity_type === 'evaluations')!
    expect(prepareJevCloudPayload(evaluation, db)).not.toMatch(/never-copy-raw|private-hash|state_preview/)
  })

  it('freezes a redacted retry body and emits tombstones for deleted records', () => {
    const created = session()
    db.prepare('UPDATE jev_setup_sessions SET title=? WHERE id=?').run('password=raw-private', created.id)
    const payload = prepareJevCloudPayload(events()[0], db)
    expect(payload).not.toContain('raw-private')
    const saved = JSON.parse(payload)
    expect(saved.payload_sha256).toBe(hashJevCloudPayload(saved.payload))
    expect(saved.payload_sha256).toMatch(/^[a-f0-9]{64}$/)
    db.prepare('UPDATE jev_setup_sessions SET title=? WHERE id=?').run('Changed later', created.id)
    expect(prepareJevCloudPayload(events()[0], db)).toBe(payload)
    db.prepare('DELETE FROM jev_setup_sessions WHERE id=?').run(created.id)
    expect(JSON.parse(prepareJevCloudPayload(events().at(-1)!, db))).toMatchObject({
      operation: 'delete', payload: { snapshot: null },
    })
  })

  it('backfills existing rows once and captures child deletion cascades', () => {
    const created = session()
    appendJevSetupExchange(created, { user: { password: 'raw-secret-value' },
      assistant: { summary: '-----BEGIN PRIVATE KEY-----\nprivate-body\n-----END PRIVATE KEY-----' },
      draft: { questions: {} }, configuration: {}, provider: 'claude-cli', model: 'haiku' }, db)
    for (const event of events()) {
      expect(prepareJevCloudPayload(event, db)).not.toMatch(/raw-secret-value|private-body/)
    }
    const before = events().length
    jevCloudMigration.up(db)
    expect(events()).toHaveLength(before)
    db.prepare('DELETE FROM jev_setup_sessions WHERE id=?').run(created.id)
    const deletions = events().filter((event) => event.operation === 'delete')
    expect(deletions.map((event) => event.entity_type).sort()).toEqual([
      'setup_messages', 'setup_messages', 'setup_revisions', 'setup_sessions',
    ])
  })

  it('marks a cloud ACK as synced without sharing workspace status', async () => {
    session()
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 201 }))
    await syncJevCloudOutbox(db, request)
    expect(request).toHaveBeenCalledOnce()
    expect(getJevCloudStatus(1, db)).toMatchObject({ pending: 0, synced: 1, state: 'synced' })
    expect(getJevCloudStatus(2, db)).toMatchObject({ pending: 0, synced: 0, lastSyncedAt: null })
  })

  it('retains failures safely and replays the identical event after acknowledgement loss', async () => {
    session()
    const failed = vi.fn().mockRejectedValue(new Error('secret transport detail'))
    await syncJevCloudOutbox(db, failed)
    expect(failed).toHaveBeenCalledTimes(2)
    expect(getJevCloudStatus(1, db)).toMatchObject({ pending: 1, state: 'retrying', errorCode: 'JEV_CLOUD_UNAVAILABLE' })
    db.prepare('UPDATE jev_cloud_outbox SET next_attempt_at=0').run()
    const success = vi.fn().mockResolvedValue(new Response(null, { status: 201 }))
    await syncJevCloudOutbox(db, success)
    expect(success.mock.calls[0][1].body).toBe(failed.mock.calls[0][1].body)
    expect(JSON.stringify(events())).not.toContain('secret transport detail')
  })

  it('prevents overlapping workers from sending the same event concurrently', async () => {
    session()
    let acknowledge: (response: Response) => void = () => undefined
    const request = vi.fn(() => new Promise<Response>((resolve) => { acknowledge = resolve }))
    const first = syncJevCloudOutbox(db, request)
    await syncJevCloudOutbox(db, request)
    expect(request).toHaveBeenCalledOnce()
    acknowledge(new Response(null, { status: 201 }))
    await first
    expect(getJevCloudStatus(1, db).state).toBe('synced')
  })

  it('fails closed on invalid configuration and reports local-only mode truthfully', async () => {
    session()
    vi.stubEnv('MC_SUPABASE_URL', 'https://attacker.example')
    const request = vi.fn()
    await expect(syncJevCloudOutbox(db, request)).rejects.toThrow('JEV_CLOUD_CONFIGURATION_INVALID')
    expect(request).not.toHaveBeenCalled()
    expect(getJevCloudStatus(1, db).state).toBe('configuration_error')
    for (const name of ['MC_SUPABASE_URL', 'MC_SUPABASE_PROJECT_REF', 'MC_SUPABASE_SECRET_KEY']) vi.stubEnv(name, '')
    await syncJevCloudOutbox(db, request)
    expect(getJevCloudStatus(1, db)).toMatchObject({ pending: 1, state: 'local_only' })
  })

  it('starts only one periodic worker for a database and can stop it', async () => {
    vi.useFakeTimers()
    for (const name of ['MC_SUPABASE_URL', 'MC_SUPABASE_PROJECT_REF', 'MC_SUPABASE_SECRET_KEY']) vi.stubEnv(name, '')
    startJevCloudSync(db)
    startJevCloudSync(db)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(5_000)
    stopJevCloudSync(db)
    expect(vi.getTimerCount()).toBe(0)
  })
})
