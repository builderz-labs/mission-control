import type Database from 'better-sqlite3'
import type { User } from '@/lib/auth'
import type { JevSetupSession } from '@/lib/jev-setup-session-types'

type Db = Database.Database
type PrincipalUser = Pick<User, 'id' | 'role' | 'agent_id'>

export function jevPrincipal(user: PrincipalUser): string {
  if (user.agent_id && user.agent_id > 0) return `agent:${user.agent_id}`
  if (user.id > 0) return `user:${user.id}`
  if (user.id < 0) return `agent-key:${Math.abs(user.id)}`
  return 'api:global'
}

export function canManageJevSession(user: PrincipalUser, session: JevSetupSession): boolean {
  if (user.role === 'admin') return true
  const owner = session.created_by_principal || `user:${session.created_by_user_id}`
  return owner === jevPrincipal(user)
}

export function resolveJevCreatorUserId(workspaceId: number, userId: number, db: Db): number | null {
  if (userId > 0) {
    const owner = db.prepare('SELECT id FROM users WHERE id=? AND workspace_id=? LIMIT 1')
      .get(userId, workspaceId) as { id: number } | undefined
    if (owner) return owner.id
  }
  const fallback = db.prepare(`
    SELECT id FROM users WHERE workspace_id=? AND is_approved=1
    ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'operator' THEN 1 ELSE 2 END, id LIMIT 1
  `).get(workspaceId) as { id: number } | undefined
  return fallback?.id ?? null
}
