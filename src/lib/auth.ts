import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { getDatabase } from './db'

export interface User {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  created_at: number
  updated_at: number
  last_login_at: number | null
}

export interface UserSession {
  id: number
  token: string
  user_id: number
  expires_at: number
  created_at: number
  ip_address: string | null
  user_agent: string | null
}

// Password hashing using Node.js built-in scrypt
const SALT_LENGTH = 16
const KEY_LENGTH = 32
const SCRYPT_COST = 16384

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString('hex')
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_COST }).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_COST })
  const storedBuf = Buffer.from(hash, 'hex')
  if (derived.length !== storedBuf.length) return false
  return timingSafeEqual(derived, storedBuf)
}

// Session management
const SESSION_DURATION = 7 * 24 * 60 * 60 // 7 days in seconds

export function createSession(userId: number, ipAddress?: string, userAgent?: string): { token: string; expiresAt: number } {
  const db = getDatabase()
  const token = randomBytes(32).toString('hex')
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + SESSION_DURATION

  db.prepare(`
    INSERT INTO user_sessions (token, user_id, expires_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, userId, expiresAt, ipAddress || null, userAgent || null)

  // Update user's last login
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, userId)

  // Clean up expired sessions
  db.prepare('DELETE FROM user_sessions WHERE expires_at < ?').run(now)

  return { token, expiresAt }
}

export function validateSession(token: string): (User & { sessionId: number }) | null {
  if (!token) return null
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.created_at, u.updated_at, u.last_login_at,
           s.id as session_id
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, now) as any

  if (!row) return null

  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
    sessionId: row.session_id,
  }
}

export function destroySession(token: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token)
}

export function destroyAllUserSessions(userId: number): void {
  const db = getDatabase()
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId)
}

// User management
export function authenticateUser(username: string, password: string): User | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any
  if (!row) return null
  if (!verifyPassword(password, row.password_hash)) return null
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
  }
}

export function getUserById(id: number): User | null {
  const db = getDatabase()
  const row = db.prepare('SELECT id, username, display_name, role, created_at, updated_at, last_login_at FROM users WHERE id = ?').get(id) as any
  return row || null
}

export function getAllUsers(): User[] {
  const db = getDatabase()
  return db.prepare('SELECT id, username, display_name, role, created_at, updated_at, last_login_at FROM users ORDER BY created_at').all() as User[]
}

export function createUser(username: string, password: string, displayName: string, role: User['role'] = 'operator'): User {
  const db = getDatabase()
  const passwordHash = hashPassword(password)
  const result = db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role)
    VALUES (?, ?, ?, ?)
  `).run(username, displayName, passwordHash, role)

  return getUserById(Number(result.lastInsertRowid))!
}

export function updateUser(id: number, updates: { display_name?: string; role?: User['role']; password?: string }): User | null {
  const db = getDatabase()
  const fields: string[] = []
  const params: any[] = []

  if (updates.display_name !== undefined) { fields.push('display_name = ?'); params.push(updates.display_name) }
  if (updates.role !== undefined) { fields.push('role = ?'); params.push(updates.role) }
  if (updates.password !== undefined) { fields.push('password_hash = ?'); params.push(hashPassword(updates.password)) }

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
 * Seed admin user from environment variables on first run.
 * If no users exist, creates an admin from AUTH_USER/AUTH_PASS env vars.
 */
export function seedAdminUser(): void {
  const db = getDatabase()
  const count = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count

  if (count > 0) return // Users already exist

  const username = process.env.AUTH_USER || 'admin'
  const password = process.env.AUTH_PASS || 'admin'
  const displayName = username.charAt(0).toUpperCase() + username.slice(1)

  createUser(username, password, displayName, 'admin')
  console.log(`Seeded admin user: ${username}`)
}

/**
 * Get user from request - checks session cookie or API key.
 * For API key auth, returns a synthetic "api" user.
 */
export function getUserFromRequest(request: Request): User | null {
  // Check session cookie
  const cookieHeader = request.headers.get('cookie') || ''
  const sessionToken = parseCookie(cookieHeader, 'mc-session')
  if (sessionToken) {
    const user = validateSession(sessionToken)
    if (user) return user
  }

  // Check API key - return synthetic user
  const apiKey = request.headers.get('x-api-key')
  if (apiKey && apiKey === process.env.API_KEY) {
    return {
      id: 0,
      username: 'api',
      display_name: 'API Access',
      role: 'admin',
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
    }
  }

  return null
}

function parseCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}
