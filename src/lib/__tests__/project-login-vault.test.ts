import Database from 'better-sqlite3'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../migrations'
import {
  createProjectLogin,
  deleteProjectLogin,
  listProjectLogins,
  revealProjectLoginPassword,
  updateProjectLogin,
} from '../project-login-vault'
import { InMemorySecretProtector } from '../social-credential-vault'

const apiState = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('@/lib/db', () => ({ getDatabase: () => apiState.db }))
vi.mock('@/lib/auth', () => ({ requireRole: () => ({ user: { username: 'admin', workspace_id: 1, role: 'admin' } }) }))
vi.mock('@/lib/enforcement/workspace-scope', () => ({ requireWorkspaceId: () => ({ workspaceId: 1 }) }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: () => null }))

let db: Database.Database
let protector: InMemorySecretProtector
let projectId: number
const password = 'vault-secret-password-123'
const input = (overrides: Record<string, unknown> = {}) => ({
  project_id: projectId,
  service: 'Example Site',
  login_url: 'https://example.com/login',
  username: 'admin@example.com',
  password,
  notes: 'Billing account',
  ...overrides,
})

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  projectId = (db.prepare('SELECT id FROM projects WHERE workspace_id = 1 ORDER BY id LIMIT 1').get() as { id: number }).id
  db.prepare(`INSERT INTO projects (workspace_id, name, slug, ticket_prefix) VALUES (2, 'Other workspace', 'other', 'OTHER')`).run()
  protector = new InMemorySecretProtector()
  apiState.db = db
})
afterEach(() => { apiState.db = null; db.close() })

describe('project login vault', () => {
  it('protects passwords at rest and omits them from list results and audit detail', () => {
    createProjectLogin(db, 1, 'admin', input(), protector)
    const row = db.prepare('SELECT protected_password FROM project_login_credentials').get() as { protected_password: string }
    expect(row.protected_password).not.toContain(password)
    expect(JSON.stringify(listProjectLogins(db, 1, projectId))).not.toContain(password)
    expect(JSON.stringify(db.prepare('SELECT detail FROM audit_log').all())).not.toContain(password)
  })

  it('reveals only on request and records reveal time without auditing the secret', () => {
    const entry = createProjectLogin(db, 1, 'admin', input(), protector)
    expect(revealProjectLoginPassword(db, 1, 'admin', entry.login_id, protector)).toBe(password)
    const listed = listProjectLogins(db, 1, projectId)[0]
    expect(listed.last_revealed_at).toBeTypeOf('number')
    const audit = JSON.stringify(db.prepare("SELECT detail FROM audit_log WHERE action = 'project_login_revealed'").all())
    expect(audit).toContain(entry.login_id)
    expect(audit).toContain('Example Site')
    expect(audit).not.toContain(password)
  })

  it('isolates credentials by workspace and requires projects owned by that workspace', () => {
    const entry = createProjectLogin(db, 1, 'admin', input(), protector)
    expect(listProjectLogins(db, 2, projectId)).toEqual([])
    expect(() => revealProjectLoginPassword(db, 2, 'other-admin', entry.login_id, protector)).toThrow('Login entry not found')
    const otherProject = (db.prepare('SELECT id FROM projects WHERE workspace_id = 2').get() as { id: number }).id
    expect(() => createProjectLogin(db, 1, 'admin', input({ project_id: otherProject }), protector)).toThrow('Project not found')
    expect(() => listProjectLogins(db, 2, projectId)).not.toThrow()
  })

  it('updates metadata, rotates a supplied password, and preserves it when omitted', () => {
    const entry = createProjectLogin(db, 1, 'admin', input(), protector)
    const before = (db.prepare('SELECT protected_password FROM project_login_credentials WHERE login_id = ?').get(entry.login_id) as { protected_password: string }).protected_password
    const metadataOnly = updateProjectLogin(db, 1, 'admin', entry.login_id, input({ password: undefined, service: 'Renamed Site' }), protector)
    const preserved = (db.prepare('SELECT protected_password FROM project_login_credentials WHERE login_id = ?').get(entry.login_id) as { protected_password: string }).protected_password
    expect(metadataOnly.service).toBe('Renamed Site')
    expect(preserved).toBe(before)
    updateProjectLogin(db, 1, 'admin', entry.login_id, input({ password: 'rotated-secret-456' }), protector)
    const rotated = (db.prepare('SELECT protected_password FROM project_login_credentials WHERE login_id = ?').get(entry.login_id) as { protected_password: string }).protected_password
    expect(rotated).not.toBe(before)
    expect(revealProjectLoginPassword(db, 1, 'admin', entry.login_id, protector)).toBe('rotated-secret-456')
  })

  it('validates login URLs and deletes entries with a secret-free audit record', () => {
    expect(() => createProjectLogin(db, 1, 'admin', input({ login_url: 'javascript:alert(1)' }), protector)).toThrow('Invalid login entry')
    expect(() => createProjectLogin(db, 1, 'admin', input({ login_url: 'https://user:password@example.com' }), protector)).toThrow('Invalid login entry')
    const entry = createProjectLogin(db, 1, 'admin', input(), protector)
    expect(deleteProjectLogin(db, 1, 'admin', entry.login_id)).toBe(true)
    expect(deleteProjectLogin(db, 1, 'admin', entry.login_id)).toBe(false)
    expect(listProjectLogins(db, 1, projectId)).toEqual([])
    expect(JSON.stringify(db.prepare('SELECT detail FROM audit_log').all())).not.toContain(password)
  })


  it('supports non-password login methods without requiring or revealing a password', () => {
    const entry = createProjectLogin(db, 1, 'admin', input({ login_method: 'google', password: undefined }), protector)
    expect(entry.login_method).toBe('google')
    expect(entry.has_password).toBe(false)
    expect(() => revealProjectLoginPassword(db, 1, 'admin', entry.login_id, protector)).toThrow('not used')
    const updated = updateProjectLogin(db, 1, 'admin', entry.login_id, input({ login_method: 'password', password: 'new-password' }), protector)
    expect(updated.login_method).toBe('password')
    expect(updated.has_password).toBe(true)
    expect(revealProjectLoginPassword(db, 1, 'admin', entry.login_id, protector)).toBe('new-password')
  })

  it('applies login vault migrations idempotently', () => {
    runMigrations(db)
    expect(db.prepare("SELECT count(*) AS count FROM schema_migrations WHERE id = '063_project_login_vault'").get()).toEqual({ count: 1 })
    expect(db.prepare("SELECT count(*) AS count FROM schema_migrations WHERE id = '064_project_login_method'").get()).toEqual({ count: 1 })
    expect(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'project_login_credentials'").get()).toEqual({ count: 1 })
  })
})

describe('project login list API', () => {
  it('returns metadata only', async () => {
    createProjectLogin(db, 1, 'admin', input(), protector)
    const { GET } = await import('../../app/api/project-logins/route')
    const response = await GET(new NextRequest(`http://localhost/api/project-logins?project_id=${projectId}`))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(JSON.stringify(body)).not.toMatch(/protected_password|protector_version|vault-secret-password/)
    expect(body.logins[0]).toMatchObject({ service: 'Example Site', username: 'admin@example.com', has_password: true })
  })
})
