import { createHmac, randomBytes, randomInt } from 'crypto'
import type Database from 'better-sqlite3'
import { getDatabase } from './db'
import type { User } from './auth'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8
export const DESKTOP_BROWSER_LOGIN_TTL_SECONDS = 5 * 60

type Db = Database.Database

interface LoginRow {
  id: number
  status: 'pending' | 'approved' | 'consumed'
  expires_at: number
  approved_by: number | null
  workspace_id: number | null
  tenant_id: number | null
}

export type DesktopBrowserLoginResult =
  | { status: 'pending'; expiresAt: number }
  | { status: 'approved'; userId: number; workspaceId: number; tenantId: number }
  | { status: 'invalid' }
  | { status: 'expired' }

function authSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim()
  if (!secret) throw new Error('DESKTOP_BROWSER_LOGIN_UNAVAILABLE')
  return secret
}

function digest(kind: 'request' | 'code', value: string): string {
  return createHmac('sha256', authSecret()).update(`${kind}:${value}`).digest('hex')
}

function generateCode(): string {
  let value = ''
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    value += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  }
  return `${value.slice(0, 4)}-${value.slice(4)}`
}

export function normalizeDesktopBrowserCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.toUpperCase().replace(/[\s-]/g, '')
  if (!new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(normalized)) return null
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`
}

function prune(db: Db, now: number): void {
  db.prepare('DELETE FROM desktop_browser_logins WHERE expires_at < ?').run(now - 86_400)
}

export function issueDesktopBrowserLogin(
  db: Db = getDatabase(),
  now = Math.floor(Date.now() / 1000),
): { requestId: string; code: string; expiresAt: number } {
  prune(db, now)
  const requestId = randomBytes(32).toString('base64url')
  const code = generateCode()
  const expiresAt = now + DESKTOP_BROWSER_LOGIN_TTL_SECONDS
  db.prepare(`
    INSERT INTO desktop_browser_logins
      (request_digest, code_digest, requested_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(digest('request', requestId), digest('code', code), now, expiresAt)
  return { requestId, code, expiresAt }
}

export function isDesktopUserSession(user: User, db: Db = getDatabase()): boolean {
  const sessionId = 'sessionId' in user && typeof user.sessionId === 'number' ? user.sessionId : null
  if (!sessionId || user.id <= 0) return false
  const row = db.prepare(`
    SELECT user_agent FROM user_sessions
    WHERE id = ? AND user_id = ? AND expires_at > unixepoch()
  `).get(sessionId, user.id) as { user_agent?: string | null } | undefined
  return row?.user_agent?.startsWith('MissionControlDesktop/') === true
}

export function approveDesktopBrowserLogin(
  rawCode: unknown,
  user: User,
  db: Db = getDatabase(),
  now = Math.floor(Date.now() / 1000),
): boolean {
  const code = normalizeDesktopBrowserCode(rawCode)
  if (!code) return false
  const result = db.prepare(`
    UPDATE desktop_browser_logins
    SET status = 'approved', approved_at = ?, approved_by = ?, workspace_id = ?, tenant_id = ?
    WHERE code_digest = ? AND status = 'pending' AND expires_at >= ?
  `).run(now, user.id, user.workspace_id, user.tenant_id, digest('code', code), now)
  return result.changes === 1
}

export function consumeDesktopBrowserLogin(
  requestId: unknown,
  db: Db = getDatabase(),
  now = Math.floor(Date.now() / 1000),
): DesktopBrowserLoginResult {
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(requestId)) {
    return { status: 'invalid' }
  }
  return db.transaction(() => {
    const row = db.prepare(`
      SELECT id, status, expires_at, approved_by, workspace_id, tenant_id
      FROM desktop_browser_logins WHERE request_digest = ?
    `).get(digest('request', requestId)) as LoginRow | undefined
    if (!row) return { status: 'invalid' } as const
    if (row.expires_at < now) return { status: 'expired' } as const
    if (row.status === 'pending') return { status: 'pending', expiresAt: row.expires_at } as const
    if (row.status !== 'approved' || !row.approved_by || !row.workspace_id || !row.tenant_id) {
      return { status: 'invalid' } as const
    }
    const consumed = db.prepare(`
      UPDATE desktop_browser_logins SET status = 'consumed', consumed_at = ?
      WHERE id = ? AND status = 'approved' AND consumed_at IS NULL
    `).run(now, row.id)
    if (consumed.changes !== 1) return { status: 'invalid' } as const
    return {
      status: 'approved', userId: row.approved_by,
      workspaceId: row.workspace_id, tenantId: row.tenant_id,
    } as const
  })()
}
