import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getSocialSecretProtector, type SecretProtector } from './social-credential-vault'

export interface ProjectLoginInput {
  project_id: number
  service: string
  login_url?: string | null
  username: string
  password?: string
  notes?: string | null
}

export interface ProjectLoginUpdateInput {
  service: string
  login_url?: string | null
  username: string
  password?: string
  notes?: string | null
}

export interface ProjectLoginView {
  login_id: string
  project_id: number
  service: string
  login_url: string | null
  username: string
  notes: string | null
  has_password: true
  created_at: number
  updated_at: number
  last_revealed_at: number | null
}

function validate(input: ProjectLoginInput, requirePassword: boolean): ProjectLoginInput {
  if (!input || !Number.isSafeInteger(input.project_id) || input.project_id <= 0) throw new Error('Invalid login entry')
  const text = (value: unknown, max: number, required = false): string | null => {
    if (value == null && !required) return null
    if (typeof value !== 'string' || value.trim().length === 0 && required || value.length > max) throw new Error('Invalid login entry')
    return value.trim()
  }
  const service = text(input.service, 200, true)!
  const username = text(input.username, 320, true)!
  let loginUrl = text(input.login_url, 2048)
  if (loginUrl) {
    let url: URL
    try { url = new URL(loginUrl) } catch { throw new Error('Invalid login entry') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid login entry')
    loginUrl = url.toString()
  }
  const notes = text(input.notes, 4000)
  const password = input.password
  if (requirePassword && (typeof password !== 'string' || password.length === 0 || password.length > 32768)) throw new Error('Invalid login entry')
  if (password !== undefined && (typeof password !== 'string' || password.length > 32768)) throw new Error('Invalid login entry')
  return { project_id: input.project_id, service, login_url: loginUrl, username, password, notes }
}

function mapRow(row: any): ProjectLoginView {
  return {
    login_id: row.login_id, project_id: row.project_id, service: row.service,
    login_url: row.login_url, username: row.username, notes: row.notes,
    has_password: true, created_at: row.created_at,
    updated_at: row.updated_at, last_revealed_at: row.last_revealed_at,
  }
}

function audit(db: Database.Database, workspaceId: number, actor: string, action: string, row: { login_id: string; project_id: number; service: string }) {
  db.prepare(`INSERT INTO audit_log (action, actor, target_type, detail, workspace_id)
    VALUES (?, ?, 'project_login', ?, ?)`).run(action, actor,
    JSON.stringify({ login_id: row.login_id, project_id: row.project_id, service: row.service }), workspaceId)
}

function requireProject(db: Database.Database, workspaceId: number, projectId: number): void {
  if (!db.prepare('SELECT 1 FROM projects WHERE id = ? AND workspace_id = ?').get(projectId, workspaceId)) throw new Error('Project not found')
}

export function listProjectLogins(db: Database.Database, workspaceId: number, projectId: number): ProjectLoginView[] {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return []
  return (db.prepare(`SELECT c.login_id, c.project_id, c.service, c.login_url, c.username, c.notes, c.created_at, c.updated_at, c.last_revealed_at
    FROM project_login_credentials c JOIN projects p ON p.id = c.project_id AND p.workspace_id = c.workspace_id
    WHERE c.workspace_id = ? AND c.project_id = ? AND p.workspace_id = ? ORDER BY c.service COLLATE NOCASE, c.username COLLATE NOCASE`)
    .all(workspaceId, projectId, workspaceId) as any[]).map(mapRow)
}

export function createProjectLogin(db: Database.Database, workspaceId: number, actor: string, rawInput: ProjectLoginInput, protector: SecretProtector = getSocialSecretProtector()): ProjectLoginView {
  const input = validate(rawInput, true)
  requireProject(db, workspaceId, input.project_id)
  let protectedPassword: string
  try { protectedPassword = protector.protect(input.password!) } catch { throw new Error('Unable to save login securely') }
  const loginId = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  db.transaction(() => {
    db.prepare(`INSERT INTO project_login_credentials
      (workspace_id, login_id, project_id, service, login_url, username, protected_password, protector_version, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(workspaceId, loginId, input.project_id, input.service, input.login_url ?? null, input.username, protectedPassword, protector.version, input.notes ?? null, actor, now, now)
    audit(db, workspaceId, actor, 'project_login_created', { login_id: loginId, project_id: input.project_id, service: input.service })
  })()
  return mapRow(db.prepare(`SELECT login_id, project_id, service, login_url, username, notes, created_at, updated_at, last_revealed_at
    FROM project_login_credentials WHERE workspace_id = ? AND login_id = ?`).get(workspaceId, loginId))
}

export function updateProjectLogin(db: Database.Database, workspaceId: number, actor: string, loginId: string, rawInput: ProjectLoginUpdateInput, protector: SecretProtector = getSocialSecretProtector()): ProjectLoginView {
  const existing = db.prepare(`SELECT c.login_id, c.project_id, c.service FROM project_login_credentials c
    JOIN projects p ON p.id = c.project_id AND p.workspace_id = c.workspace_id
    WHERE c.workspace_id = ? AND c.login_id = ?`).get(workspaceId, loginId) as { login_id: string; project_id: number; service: string } | undefined
  if (!existing) throw new Error('Login entry not found')
  requireProject(db, workspaceId, existing.project_id)
  const input = validate({ ...rawInput, project_id: existing.project_id }, false)
  let protectedPassword: string | undefined
  if (input.password) {
    try { protectedPassword = protector.protect(input.password) } catch { throw new Error('Unable to save login securely') }
  }
  const now = Math.floor(Date.now() / 1000)
  db.transaction(() => {
    db.prepare(`UPDATE project_login_credentials SET project_id = ?, service = ?, login_url = ?, username = ?, notes = ?, updated_at = ?,
      protected_password = COALESCE(?, protected_password), protector_version = CASE WHEN ? IS NULL THEN protector_version ELSE ? END
      WHERE workspace_id = ? AND login_id = ?`)
      .run(existing.project_id, input.service, input.login_url ?? null, input.username, input.notes ?? null, now,
        protectedPassword ?? null, protectedPassword ?? null, protector.version, workspaceId, loginId)
    audit(db, workspaceId, actor, 'project_login_updated', { login_id: loginId, project_id: existing.project_id, service: input.service })
  })()
  return mapRow(db.prepare(`SELECT login_id, project_id, service, login_url, username, notes, created_at, updated_at, last_revealed_at
    FROM project_login_credentials WHERE workspace_id = ? AND login_id = ?`).get(workspaceId, loginId))
}

export function revealProjectLoginPassword(db: Database.Database, workspaceId: number, actor: string, loginId: string, protector: SecretProtector = getSocialSecretProtector()): string {
  const row = db.prepare(`SELECT c.project_id, c.service, c.protected_password FROM project_login_credentials c
    JOIN projects p ON p.id = c.project_id AND p.workspace_id = c.workspace_id WHERE c.workspace_id = ? AND c.login_id = ?`)
    .get(workspaceId, loginId) as { project_id: number; service: string; protected_password: string } | undefined
  if (!row) throw new Error('Login entry not found')
  let password: string
  try { password = protector.unprotect(row.protected_password) } catch { throw new Error('Unable to reveal login password') }
  const now = Math.floor(Date.now() / 1000)
  db.transaction(() => {
    db.prepare('UPDATE project_login_credentials SET last_revealed_at = ? WHERE workspace_id = ? AND login_id = ?').run(now, workspaceId, loginId)
    audit(db, workspaceId, actor, 'project_login_revealed', { login_id: loginId, project_id: row.project_id, service: row.service })
  })()
  return password
}

export function deleteProjectLogin(db: Database.Database, workspaceId: number, actor: string, loginId: string): boolean {
  const row = db.prepare(`SELECT c.project_id, c.service FROM project_login_credentials c
    JOIN projects p ON p.id = c.project_id AND p.workspace_id = c.workspace_id WHERE c.workspace_id = ? AND c.login_id = ?`)
    .get(workspaceId, loginId) as { project_id: number; service: string } | undefined
  if (!row) return false
  db.transaction(() => {
    db.prepare('DELETE FROM project_login_credentials WHERE workspace_id = ? AND login_id = ?').run(workspaceId, loginId)
    audit(db, workspaceId, actor, 'project_login_deleted', { login_id: loginId, project_id: row.project_id, service: row.service })
  })()
  return true
}
