import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'
import { runMigrations } from '@/lib/migrations'

let db: InstanceType<typeof Database>
const requireRole = vi.fn()
const logAuditEvent = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: () => db,
  logAuditEvent,
}))

vi.mock('@/lib/auth', () => ({ requireRole }))
vi.mock('@/lib/rate-limit', () => ({ heavyLimiter: vi.fn(() => null) }))

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  requireRole.mockReturnValue({
    user: { id: 2, username: 'workspace-two-admin', role: 'admin', workspace_id: 2, tenant_id: 1 },
  })
  db.prepare("INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (2, 'two', 'Two', 1)").run()
  db.prepare("INSERT INTO audit_log (action, actor, workspace_id) VALUES ('workspace.one', 'one', 1)").run()
  db.prepare("INSERT INTO audit_log (action, actor, workspace_id) VALUES ('workspace.two', 'two', 2)").run()
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

describe('migration 053_audit_log_workspace', () => {
  it('adds indexed workspace ownership and assigns legacy rows to the default workspace', () => {
    db.exec(`
      CREATE TABLE legacy_audit_log AS
      SELECT id, action, actor, actor_id, target_type, target_id, detail, ip_address, user_agent, created_at
      FROM audit_log
    `)
    db.exec('DROP TABLE audit_log')
    db.exec('ALTER TABLE legacy_audit_log RENAME TO audit_log')
    db.prepare("INSERT INTO audit_log (action, actor, created_at) VALUES ('legacy', 'legacy', unixepoch())").run()
    db.prepare("DELETE FROM schema_migrations WHERE id = '053_audit_log_workspace'").run()
    runMigrations(db)

    const columns = db.prepare('PRAGMA table_info(audit_log)').all() as Array<{ name: string; notnull: number; dflt_value: string | null }>
    const workspaceColumn = columns.find((column) => column.name === 'workspace_id')
    expect(workspaceColumn).toMatchObject({ notnull: 1, dflt_value: '1' })

    const indexes = db.prepare("PRAGMA index_list('audit_log')").all() as Array<{ name: string }>
    expect(indexes.map((index) => index.name)).toContain('idx_audit_log_workspace_created')
    expect(db.prepare("SELECT id FROM schema_migrations WHERE id = '053_audit_log_workspace'").get()).toBeDefined()
    expect(db.prepare("SELECT workspace_id FROM audit_log WHERE action = 'legacy'").get()).toEqual({ workspace_id: 1 })
  })
})

describe('audit API workspace isolation', () => {
  it('lists only records owned by the authenticated workspace', async () => {
    const { GET } = await import('@/app/api/audit/route')
    const response = await GET(new NextRequest('http://localhost/api/audit'))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.total).toBe(1)
    expect(body.events.map((event: { action: string }) => event.action)).toEqual(['workspace.two'])
  })

  it('exports only records owned by the authenticated workspace', async () => {
    const { GET } = await import('@/app/api/export/route')
    const response = await GET(new NextRequest('http://localhost/api/export?type=audit&format=json'))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.count).toBe(1)
    expect(body.data.map((event: { action: string }) => event.action)).toEqual(['workspace.two'])
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: 2 }))
  })

  it('searches audit records only inside the authenticated workspace', async () => {
    const { GET } = await import('@/app/api/search/route')
    const response = await GET(new NextRequest('http://localhost/api/search?q=workspace&type=audit'))
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.results.map((result: { title: string }) => result.title)).toEqual(['workspace.two'])
  })
})
