// @vitest-environment node
import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '@/lib/migrations'

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), assistant: vi.fn(), audit: vi.fn() }))
let db: InstanceType<typeof Database>

vi.mock('@/lib/db', () => ({ getDatabase: () => db, logAuditEvent: mocks.audit }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: vi.fn(() => null) }))
vi.mock('@/lib/jev-assistant-rate-limit', () => ({ jevAssistantLimiter: vi.fn(() => null) }))
vi.mock('@/lib/jev-assistant-service', () => ({ createJevAssistantDraft: mocks.assistant }))

const questions = { ready: { type: 'noul', instructions: 'Is this ready?' } }
const configuration = (projectIds: number[], scope = 'selected') => ({
  scope, projectIds, trigger: 'manual', enforcement: 'advisory', contextMode: 'safe_repository',
  failureMode: 'retry_then_review', rollout: 'shadow', retainPreview: false,
  uncertaintyThreshold: 0.65, tests: [], risks: [], observability: [],
})

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  db.prepare("INSERT INTO tenants (id,slug,display_name,linux_user,openclaw_home,workspace_root) VALUES (2,'two','Two','two','/tmp/two','/tmp/two')").run()
  db.prepare("INSERT INTO workspaces (id,slug,name,tenant_id) VALUES (2,'two','Two',2)").run()
  db.prepare("INSERT INTO projects (id,workspace_id,name,slug,ticket_prefix) VALUES (81,1,'One','one','ONE')").run()
  db.prepare("INSERT INTO projects (id,workspace_id,name,slug,ticket_prefix) VALUES (83,1,'Three','three','THR')").run()
  db.prepare("INSERT INTO projects (id,workspace_id,name,slug,ticket_prefix) VALUES (82,2,'Two','two','TWO')").run()
  mocks.requireRole.mockReturnValue({
    user: { id: 1, username: 'op', role: 'operator', workspace_id: 1, tenant_id: 1 },
  })
  mocks.assistant.mockReset()
  mocks.audit.mockReset()
})

afterEach(() => db?.close())

async function bulk(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/jev/policies/bulk/route')
  return POST(new NextRequest('http://localhost/api/jev/policies/bulk', {
    method: 'POST', body: JSON.stringify(body),
  }))
}

describe('Jev bulk policy routes', () => {
  it('creates one validated policy per selected repository atomically', async () => {
    const response = await bulk({ projectIds: [81, 83], name: 'Shared review', questions })
    expect(response.status).toBe(201)
    expect(db.prepare('SELECT COUNT(*) AS count FROM jev_policies').get()).toEqual({ count: 2 })
  })

  it('stores only each authorized target on its materialized policy copy', async () => {
    const response = await bulk({
      projectIds: [81, 83], name: 'Scoped copies', configuration: configuration([81, 83]), questions,
    })
    expect(response.status).toBe(201)
    const rows = db.prepare('SELECT configuration FROM jev_policies ORDER BY project_id').all() as Array<{
      configuration: string
    }>
    expect(rows.map((row) => JSON.parse(row.configuration).projectIds)).toEqual([[81], [83]])
  })

  it('atomically applies one approved revision to every materialized policy', async () => {
    const sessionId = '3ad3e1d6-f7b5-40fd-a437-ac506ad38e64'
    db.prepare(`INSERT OR IGNORE INTO users
      (id,username,display_name,password_hash,role,workspace_id) VALUES (1,'op','Operator','unused','operator',1)`).run()
    db.prepare(`INSERT INTO jev_setup_sessions
      (id,workspace_id,project_id,created_by_user_id,title,provider,model)
      VALUES (?,1,81,1,'Shared review','claude-cli','haiku')`).run(sessionId)
    db.prepare(`INSERT INTO jev_setup_revisions
      (workspace_id,session_id,revision_no,draft,configuration,provider,model)
      VALUES (1,?,1,'{}','{}','claude-cli','haiku')`).run(sessionId)
    const response = await bulk({
      projectIds: [81, 83], name: 'Approved set', configuration: configuration([81, 83]), questions,
      approval: { sessionId, expectedRevisionNo: 1 },
    })
    expect(response.status).toBe(201)
    expect(db.prepare('SELECT status FROM jev_setup_sessions WHERE id=?').get(sessionId))
      .toEqual({ status: 'ready' })
    expect(db.prepare('SELECT COUNT(*) AS count FROM jev_setup_revision_policies').get())
      .toEqual({ count: 2 })
    expect(db.prepare("SELECT status FROM jev_setup_revisions WHERE session_id=? AND revision_no=2")
      .get(sessionId)).toEqual({ status: 'applied' })
  })

  it('rejects foreign repositories before bulk policy creation', async () => {
    const response = await bulk({ projectIds: [81, 82], name: 'Unsafe set', questions })
    expect(response.status).toBe(404)
    expect(db.prepare('SELECT COUNT(*) AS count FROM jev_policies').get()).toEqual({ count: 0 })
  })

  it('rejects configuration targets that differ from policy targets', async () => {
    const response = await bulk({
      projectIds: [81], name: 'Confused target', questions, configuration: configuration([82]),
    })
    expect(response.status).toBe(400)
    expect(db.prepare('SELECT COUNT(*) AS count FROM jev_policies').get()).toEqual({ count: 0 })
  })

  it('resolves all-repository scope against every active workspace project', async () => {
    const response = await bulk({
      projectIds: [81, 83], name: 'Incomplete all scope', questions,
      configuration: configuration([81, 83], 'all'),
    })
    expect(response.status).toBe(400)
    expect(db.prepare('SELECT COUNT(*) AS count FROM jev_policies').get()).toEqual({ count: 0 })
  })

  it('keeps assistant scope inside the authenticated workspace', async () => {
    mocks.assistant.mockResolvedValue({ draft: { questions: { ready: {} } }, configuration: {}, warnings: [] })
    const { POST } = await import('@/app/api/jev/assistant/route')
    const response = await POST(new NextRequest('http://localhost/api/jev/assistant', {
      method: 'POST', body: JSON.stringify({
        action: 'draft', goal: 'Assess readiness', answers: {}, projectIds: [82],
      }),
    }))
    expect(response.status).toBe(404)
    expect(mocks.assistant).not.toHaveBeenCalled()
  })
})
