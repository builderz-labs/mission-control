import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import type { User } from '@/lib/auth'
import {
  approveDesktopBrowserLogin,
  consumeDesktopBrowserLogin,
  isDesktopUserSession,
  issueDesktopBrowserLogin,
  normalizeDesktopBrowserCode,
} from '@/lib/desktop-browser-login'

let db: InstanceType<typeof Database>
let desktopUser: User & { sessionId: number }
const originalSecret = process.env.AUTH_SECRET

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-only-desktop-browser-login-secret'
  db = new Database(':memory:')
  runMigrations(db)
  const user = db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role, workspace_id, provider, is_approved)
    VALUES ('admin', 'Admin', 'unused', 'admin', 1, 'local', 1)
  `).run()
  const session = db.prepare(`
    INSERT INTO user_sessions (token, user_id, expires_at, user_agent, workspace_id, tenant_id)
    VALUES ('desktop-session', ?, 9999999999, 'MissionControlDesktop/1.0', 1, 1)
  `).run(user.lastInsertRowid)
  desktopUser = {
    id: Number(user.lastInsertRowid), username: 'admin', display_name: 'Admin', role: 'admin',
    workspace_id: 1, tenant_id: 1, provider: 'local', created_at: 1, updated_at: 1,
    last_login_at: null, sessionId: Number(session.lastInsertRowid),
  }
})

afterEach(() => {
  db.close()
  if (originalSecret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = originalSecret
})

describe('desktop-approved browser login', () => {
  it('stores only keyed digests and consumes an approval exactly once', () => {
    const issued = issueDesktopBrowserLogin(db, 1_000)
    const stored = db.prepare(`
      SELECT request_digest, code_digest FROM desktop_browser_logins
    `).get() as { request_digest: string; code_digest: string }
    expect(stored.request_digest).not.toContain(issued.requestId)
    expect(stored.code_digest).not.toContain(issued.code.replace('-', ''))
    expect(consumeDesktopBrowserLogin(issued.requestId, db, 1_001)).toMatchObject({ status: 'pending' })
    expect(approveDesktopBrowserLogin(issued.code, desktopUser, db, 1_002)).toBe(true)
    expect(consumeDesktopBrowserLogin(issued.requestId, db, 1_003)).toEqual({
      status: 'approved', userId: desktopUser.id, workspaceId: 1, tenantId: 1,
    })
    expect(consumeDesktopBrowserLogin(issued.requestId, db, 1_004)).toEqual({ status: 'invalid' })
  })

  it('rejects expired, malformed, and incorrect codes', () => {
    const issued = issueDesktopBrowserLogin(db, 2_000)
    expect(approveDesktopBrowserLogin('not-a-code', desktopUser, db, 2_001)).toBe(false)
    expect(approveDesktopBrowserLogin('AAAA-2222', desktopUser, db, 2_001)).toBe(false)
    expect(approveDesktopBrowserLogin(issued.code, desktopUser, db, issued.expiresAt + 1)).toBe(false)
    expect(consumeDesktopBrowserLogin(issued.requestId, db, issued.expiresAt + 1)).toEqual({ status: 'expired' })
    expect(consumeDesktopBrowserLogin('../invalid', db, 2_001)).toEqual({ status: 'invalid' })
  })

  it('recognizes only a current session originally created by the desktop app', () => {
    expect(isDesktopUserSession(desktopUser, db)).toBe(true)
    db.prepare("UPDATE user_sessions SET user_agent = 'Mozilla/5.0' WHERE id = ?").run(desktopUser.sessionId)
    expect(isDesktopUserSession(desktopUser, db)).toBe(false)
    expect(isDesktopUserSession({ ...desktopUser, id: 0 }, db)).toBe(false)
  })

  it('normalizes human-entered codes without accepting ambiguous characters', () => {
    expect(normalizeDesktopBrowserCode('abcd 2345')).toBe('ABCD-2345')
    expect(normalizeDesktopBrowserCode('ABCI-2345')).toBeNull()
    expect(normalizeDesktopBrowserCode('ABCD-234O')).toBeNull()
  })
})
