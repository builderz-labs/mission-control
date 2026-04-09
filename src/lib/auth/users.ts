// User management: lookup, creation, update, deletion, and authentication.

import { randomBytes } from 'crypto'
import { SqlParam } from '../types/sql'
import { getDatabase } from '../db'
import { hashPassword, verifyPassword } from '../password'
import { logSecurityEvent } from '../security-events'
import type { User, UserQueryRow } from './types'
import { getDefaultWorkspaceContext, resolveTenantForWorkspace } from './workspace-context'
import { destroyAllUserSessions } from './session'

// Dummy hash used for constant-time rejection when user doesn't exist.
// This ensures authenticateUser takes the same time whether or not the username is valid,
// preventing timing-based username enumeration.
const DUMMY_HASH = '0000000000000000000000000000000000000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000'

export function authenticateUser(username: string, password: string): User | null {
  const db = getDatabase()
  const row = db.prepare('SELECT id, username, display_name, password_hash, role, created_at, updated_at, last_login_at, workspace_id, provider, provider_user_id, email, avatar_url, is_approved, approved_by, approved_at FROM users WHERE username = ?').get(username) as UserQueryRow | undefined
  if (!row) {
    // Always run verifyPassword to prevent timing-based username enumeration
    verifyPassword(password, DUMMY_HASH)
    try { logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'user_not_found' }), workspace_id: 1, tenant_id: 1 }) } catch {}
    return null
  }
  if ((row.provider || 'local') !== 'local') {
    verifyPassword(password, DUMMY_HASH)
    try { logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'wrong_provider' }), workspace_id: 1, tenant_id: 1 }) } catch {}
    return null
  }
  if ((row.is_approved ?? 1) !== 1) {
    verifyPassword(password, DUMMY_HASH)
    try { logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'not_approved' }), workspace_id: 1, tenant_id: 1 }) } catch {}
    return null
  }
  if (!verifyPassword(password, row.password_hash)) {
    try { logSecurityEvent({ event_type: 'auth_failure', severity: 'warning', source: 'auth', detail: JSON.stringify({ username, reason: 'invalid_password' }), workspace_id: 1, tenant_id: 1 }) } catch {}
    return null
  }
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    workspace_id: row.workspace_id || getDefaultWorkspaceContext().workspaceId,
    tenant_id: resolveTenantForWorkspace(row.workspace_id || getDefaultWorkspaceContext().workspaceId),
    provider: row.provider || 'local',
    email: row.email ?? null,
    avatar_url: row.avatar_url ?? null,
    is_approved: row.is_approved ?? 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
  }
}

export function getUserById(id: number): User | null {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.workspace_id, COALESCE(w.tenant_id, 1) as tenant_id,
           u.provider, u.email, u.avatar_url, u.is_approved, u.created_at, u.updated_at, u.last_login_at
    FROM users u
    LEFT JOIN workspaces w ON w.id = u.workspace_id
    WHERE u.id = ?
  `).get(id) as User | undefined
  return row ? { ...row, tenant_id: row.tenant_id || getDefaultWorkspaceContext().tenantId } : null
}

export function getAllUsers(): User[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.workspace_id, COALESCE(w.tenant_id, 1) as tenant_id,
           u.provider, u.email, u.avatar_url, u.is_approved, u.created_at, u.updated_at, u.last_login_at
    FROM users u
    LEFT JOIN workspaces w ON w.id = u.workspace_id
    ORDER BY u.created_at
  `).all() as User[]
}

export function createUser(
  username: string,
  password: string,
  displayName: string,
  role: User['role'] = 'operator',
  options?: { provider?: 'local' | 'google'; provider_user_id?: string | null; email?: string | null; avatar_url?: string | null; is_approved?: 0 | 1; approved_by?: string | null; approved_at?: number | null; workspace_id?: number }
): User {
  const db = getDatabase()
  if (password.length < 12) throw new Error('Password must be at least 12 characters')
  const passwordHash = hashPassword(password)
  const provider = options?.provider || 'local'
  const workspaceId = options?.workspace_id || getDefaultWorkspaceContext().workspaceId
  const result = db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role, provider, provider_user_id, email, avatar_url, is_approved, approved_by, approved_at, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    username,
    displayName,
    passwordHash,
    role,
    provider,
    options?.provider_user_id || null,
    options?.email || null,
    options?.avatar_url || null,
    typeof options?.is_approved === 'number' ? options.is_approved : 1,
    options?.approved_by || null,
    options?.approved_at || null,
    workspaceId,
  )

  return getUserById(Number(result.lastInsertRowid))!
}

export function updateUser(id: number, updates: { display_name?: string; role?: User['role']; password?: string; email?: string | null; avatar_url?: string | null; is_approved?: 0 | 1 }): User | null {
  const db = getDatabase()
  const fields: string[] = []
  const params: SqlParam[] = []

  if (updates.display_name !== undefined) { fields.push('display_name = ?'); params.push(updates.display_name) }
  if (updates.role !== undefined) { fields.push('role = ?'); params.push(updates.role) }
  if (updates.password !== undefined) { fields.push('password_hash = ?'); params.push(hashPassword(updates.password)) }
  if (updates.email !== undefined) { fields.push('email = ?'); params.push(updates.email) }
  if (updates.avatar_url !== undefined) { fields.push('avatar_url = ?'); params.push(updates.avatar_url) }
  if (updates.is_approved !== undefined) { fields.push('is_approved = ?'); params.push(updates.is_approved) }

  if (fields.length === 0) return getUserById(id)

  fields.push('updated_at = ?')
  params.push(Math.floor(Date.now() / 1000))
  params.push(id)

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  return getUserById(id)
}

export function deleteUser(id: number): boolean {
  const db = getDatabase()
  destroyAllUserSessions(id)
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * Resolve a user by username for proxy auth.
 * If the user does not exist and MC_PROXY_AUTH_DEFAULT_ROLE is set, auto-provisions them.
 * Auto-provisioned users receive a random unusable password — they cannot log in locally.
 */
export function resolveOrProvisionProxyUser(username: string): User | null {
  try {
    const db = getDatabase()
    const { workspaceId } = getDefaultWorkspaceContext()

    const row = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.workspace_id,
             COALESCE(w.tenant_id, 1) as tenant_id,
             u.provider, u.email, u.avatar_url, u.is_approved,
             u.created_at, u.updated_at, u.last_login_at
      FROM users u
      LEFT JOIN workspaces w ON w.id = u.workspace_id
      WHERE u.username = ?
    `).get(username) as UserQueryRow | undefined

    if (row) {
      if ((row.is_approved ?? 1) !== 1) return null
      return {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
        workspace_id: row.workspace_id || workspaceId,
        tenant_id: resolveTenantForWorkspace(row.workspace_id || workspaceId),
        provider: row.provider || 'local',
        email: row.email ?? null,
        avatar_url: row.avatar_url ?? null,
        is_approved: row.is_approved ?? 1,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_login_at: row.last_login_at,
      }
    }

    // Auto-provision if MC_PROXY_AUTH_DEFAULT_ROLE is configured
    const defaultRole = (process.env.MC_PROXY_AUTH_DEFAULT_ROLE || '').trim()
    if (!defaultRole || !(['viewer', 'operator', 'admin'] as const).includes(defaultRole as User['role'])) {
      return null
    }

    // Random password — proxy users cannot log in via the local login form
    return createUser(username, randomBytes(32).toString('hex'), username, defaultRole as User['role'])
  } catch {
    return null
  }
}
