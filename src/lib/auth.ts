import { randomBytes, timingSafeEqual } from 'crypto'
import { getDatabase } from './db'
import { hashPassword, verifyPassword } from './password'

// ---------------------------------------------------------------------------
// Upstash Redis helpers (REST API — no extra dependencies)
// ---------------------------------------------------------------------------
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

async function redisCmd(...args: (string | number)[]): Promise<unknown> {
  if (!REDIS_URL || !REDIS_TOKEN) return null
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`Redis error: ${res.status}`)
  const json = await res.json() as { result: unknown }
  return json.result
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Compare against dummy buffer to avoid timing leak on length mismatch
    const dummy = Buffer.alloc(bufA.length)
    timingSafeEqual(bufA, dummy)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export interface User {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  workspace_id: number
  provider?: 'local' | 'google'
  email?: string | null
  avatar_url?: string | null
  is_approved?: number
  created_at: number
  updated_at: number
  last_login_at: number | null
  /** Agent name when request is made on behalf of a specific agent (via X-Agent-Name header) */
  agent_name?: string | null
}

export interface UserSession {
  id: number
  token: string
  user_id: number
  workspace_id: number
  expires_at: number
  created_at: number
  ip_address: string | null
  user_agent: string | null
}

interface SessionQueryRow {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  provider: 'local' | 'google' | null
  email: string | null
  avatar_url: string | null
  is_approved: number
  workspace_id: number
  created_at: number
  updated_at: number
  last_login_at: number | null
  session_id: number
}

interface UserQueryRow {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  provider: 'local' | 'google' | null
  email: string | null
  avatar_url: string | null
  is_approved: number
  workspace_id: number
  created_at: number
  updated_at: number
  last_login_at: number | null
  password_hash: string
}

// Session management
const SESSION_DURATION = 7 * 24 * 60 * 60 // 7 days in seconds

function getDefaultWorkspaceId(): number {
  try {
    const db = getDatabase()
    const row = db.prepare(`SELECT id FROM workspaces WHERE slug = 'default' LIMIT 1`).get() as { id?: number } | undefined
    return row?.id || 1
  } catch {
    return 1
  }
}

export function getWorkspaceIdFromRequest(request: Request): number {
  const user = getUserFromRequest(request)
  return user?.workspace_id || getDefaultWorkspaceId()
}

export function createSession(
  userId: number,
  ipAddress?: string,
  userAgent?: string,
  workspaceId?: number
): { token: string; expiresAt: number } {
  const db = getDatabase()
  const token = randomBytes(32).toString('hex')
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + SESSION_DURATION
  const resolvedWorkspaceId = workspaceId ?? ((db.prepare('SELECT workspace_id FROM users WHERE id = ?').get(userId) as { workspace_id?: number } | undefined)?.workspace_id || getDefaultWorkspaceId())

  // Write to Redis (primary, async fire-and-forget — failures fall back to SQLite)
  if (REDIS_URL && REDIS_TOKEN) {
    // Include full user object so cold-start instances don't need SQLite for auth
    const userRow = db.prepare('SELECT id, username, display_name, role, provider, email, avatar_url, is_approved, workspace_id, created_at, updated_at, last_login_at FROM users WHERE id = ?').get(userId) as User | undefined
    const payload = JSON.stringify({ userId, workspaceId: resolvedWorkspaceId, expiresAt, ipAddress: ipAddress || null, userAgent: userAgent || null, user: userRow || null })
    redisCmd('SET', `session:${token}`, payload, 'EX', SESSION_DURATION).catch(() => {})
    redisCmd('SADD', `user_sessions:${userId}`, token).catch(() => {})
    redisCmd('EXPIRE', `user_sessions:${userId}`, SESSION_DURATION).catch(() => {})
  }

  db.prepare(`
    INSERT INTO user_sessions (token, user_id, expires_at, ip_address, user_agent, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(token, userId, expiresAt, ipAddress || null, userAgent || null, resolvedWorkspaceId)

  // Update user's last login
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, userId)

  // Clean up expired sessions
  db.prepare('DELETE FROM user_sessions WHERE expires_at < ?').run(now)

  return { token, expiresAt }
}

export function validateSession(token: string): (User & { sessionId: number }) | null {
  if (!token) return null

  // Redis path — if configured, use it as primary source
  if (REDIS_URL && REDIS_TOKEN) {
    // Return a Promise-based wrapper; Next.js route handlers are async so this is safe
    // We use a synchronous-looking wrapper by checking the cache via a dedicated async helper
    // exposed as a separate export below. For the sync path, fall through to SQLite.
    // Instead: make validateSession async-capable by returning the result from an IIFE that
    // the caller awaits. But since the existing call sites use it synchronously, we need
    // to bridge the gap. We'll use a synchronous approach for SQLite only, and add an
    // async validateSessionAsync for new Redis-aware call sites.
    // For now: fall through to SQLite (existing behaviour) — see validateSessionAsync below.
  }

  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.provider, u.email, u.avatar_url, u.is_approved, COALESCE(s.workspace_id, u.workspace_id, 1) as workspace_id, u.created_at, u.updated_at, u.last_login_at,
           s.id as session_id
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, now) as SessionQueryRow | undefined

  if (!row) return null

  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    workspace_id: row.workspace_id || getDefaultWorkspaceId(),
    provider: row.provider || 'local',
    email: row.email ?? null,
    avatar_url: row.avatar_url ?? null,
    is_approved: typeof row.is_approved === 'number' ? row.is_approved : 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at,
    sessionId: row.session_id,
  }
}

/**
 * Async version of validateSession — checks Redis first, falls back to SQLite.
 * Use this in route handlers / middleware where async is fine.
 */
export async function validateSessionAsync(token: string): Promise<(User & { sessionId: number }) | null> {
  if (!token) return null

  if (REDIS_URL && REDIS_TOKEN) {
    try {
      const raw = await redisCmd('GET', `session:${token}`) as string | null
      if (raw) {
        const s = JSON.parse(raw) as { userId: number; workspaceId: number; expiresAt: number; ipAddress: string | null; userAgent: string | null; user?: User }
        const now = Math.floor(Date.now() / 1000)
        if (s.expiresAt > now) {
          // Fetch user row from SQLite for full user details
          const db = getDatabase()
          const user = db.prepare('SELECT id, username, display_name, role, provider, email, avatar_url, is_approved, workspace_id, created_at, updated_at, last_login_at FROM users WHERE id = ?').get(s.userId) as (User & { password_hash?: string }) | undefined

          // On Vercel cold starts SQLite is empty — fall back to user embedded in Redis session
          const resolvedUser = user ?? s.user

          if (resolvedUser) {
            return {
              id: resolvedUser.id,
              username: resolvedUser.username,
              display_name: resolvedUser.display_name,
              role: resolvedUser.role,
              workspace_id: s.workspaceId || resolvedUser.workspace_id || getDefaultWorkspaceId(),
              provider: resolvedUser.provider || 'local',
              email: resolvedUser.email ?? null,
              avatar_url: resolvedUser.avatar_url ?? null,
              is_approved: typeof resolvedUser.is_approved === 'number' ? resolvedUser.is_approved : 1,
              created_at: resolvedUser.created_at,
              updated_at: resolvedUser.updated_at,
              last_login_at: resolvedUser.last_login_at ?? null,
              sessionId: 0, // Redis sessions don't have a numeric ID
            }
          }
        } else {
          // Expired — clean up
          redisCmd('DEL', `session:${token}`).catch(() => {})
        }
      }
    } catch {
      // Redis error — fall through to SQLite
    }
  }

  return validateSession(token)
}

export function destroySession(token: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token)
  // Also remove from Redis (fire-and-forget)
  if (REDIS_URL && REDIS_TOKEN) {
    redisCmd('DEL', `session:${token}`).catch(() => {})
  }
}

export function destroyAllUserSessions(userId: number): void {
  const db = getDatabase()
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId)
  // Also remove from Redis (fire-and-forget)
  if (REDIS_URL && REDIS_TOKEN) {
    redisCmd('SMEMBERS', `user_sessions:${userId}`).then((tokens) => {
      if (Array.isArray(tokens) && tokens.length > 0) {
        const delKeys = tokens.map(t => `session:${t}`)
        redisCmd('DEL', ...delKeys).catch(() => {})
        redisCmd('DEL', `user_sessions:${userId}`).catch(() => {})
      }
    }).catch(() => {})
  }
}

// User management
export function authenticateUser(username: string, password: string): User | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserQueryRow | undefined
  if (!row) return null
  if ((row.provider || 'local') !== 'local') return null
  if ((row.is_approved ?? 1) !== 1) return null
  if (!verifyPassword(password, row.password_hash)) return null
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    workspace_id: row.workspace_id || getDefaultWorkspaceId(),
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
  const row = db.prepare('SELECT id, username, display_name, role, workspace_id, provider, email, avatar_url, is_approved, created_at, updated_at, last_login_at FROM users WHERE id = ?').get(id) as User | undefined
  return row || null
}

export function getAllUsers(): User[] {
  const db = getDatabase()
  return db.prepare('SELECT id, username, display_name, role, workspace_id, provider, email, avatar_url, is_approved, created_at, updated_at, last_login_at FROM users ORDER BY created_at').all() as User[]
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
  const workspaceId = options?.workspace_id || getDefaultWorkspaceId()
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
  const params: any[] = []

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
 * Seed admin user from environment variables on first run.
 * If no users exist, creates an admin from AUTH_USER/AUTH_PASS env vars.
 */
/**
 * Get user from request - checks session cookie or API key.
 * For API key auth, returns a synthetic "api" user.
 */
export function getUserFromRequest(request: Request): User | null {
  // Extract agent identity header (optional, for attribution)
  const agentName = (request.headers.get('x-agent-name') || '').trim() || null

  // Check Redis-validated session header (injected by Edge middleware)
  const redisUserHeader = request.headers.get('x-mc-redis-user')
  if (redisUserHeader) {
    try {
      const { userId, workspaceId, user: redisUser } = JSON.parse(redisUserHeader) as { userId: number; workspaceId: number; token: string; user?: User | null }
      // Try SQLite first; fall back to the user object stored in Redis (works on cold-start instances)
      let user: User | undefined
      try {
        const db = getDatabase()
        user = db.prepare('SELECT id, username, display_name, role, provider, email, avatar_url, is_approved, workspace_id, created_at, updated_at, last_login_at FROM users WHERE id = ?').get(userId) as User | undefined
      } catch {
        // SQLite not ready (cold start) — use Redis-stored user
      }
      const resolved = user ?? redisUser ?? undefined
      if (resolved) {
        return {
          ...resolved,
          workspace_id: workspaceId || resolved.workspace_id || getDefaultWorkspaceId(),
          provider: resolved.provider || 'local',
          email: resolved.email ?? null,
          avatar_url: resolved.avatar_url ?? null,
          is_approved: typeof resolved.is_approved === 'number' ? resolved.is_approved : 1,
          agent_name: agentName,
        }
      }
    } catch {
      // Malformed header — fall through to cookie check
    }
  }

  // Check session cookie (SQLite fallback — works locally or if Redis is bypassed)
  const cookieHeader = request.headers.get('cookie') || ''
  const sessionToken = parseCookie(cookieHeader, 'mc-session')
  if (sessionToken) {
    const user = validateSession(sessionToken)
    if (user) return { ...user, agent_name: agentName }
  }

  // Check API key - return synthetic user
  const configuredApiKey = (process.env.API_KEY || '').trim()
  const apiKey = extractApiKeyFromHeaders(request.headers)
  if (configuredApiKey && apiKey && safeCompare(apiKey, configuredApiKey)) {
    return {
      id: 0,
      username: 'api',
      display_name: 'API Access',
      role: 'admin',
      workspace_id: getDefaultWorkspaceId(),
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
      agent_name: agentName,
    }
  }

  return null
}

function extractApiKeyFromHeaders(headers: Headers): string | null {
  const direct = (headers.get('x-api-key') || '').trim()
  if (direct) return direct

  const authorization = (headers.get('authorization') || '').trim()
  if (!authorization) return null

  const [scheme, ...rest] = authorization.split(/\s+/)
  if (!scheme || rest.length === 0) return null

  const normalized = scheme.toLowerCase()
  if (normalized === 'bearer' || normalized === 'apikey' || normalized === 'token') {
    return rest.join(' ').trim() || null
  }

  return null
}

/**
 * Role hierarchy levels for access control.
 * viewer < operator < admin
 */
const ROLE_LEVELS: Record<string, number> = { viewer: 0, operator: 1, admin: 2 }

/**
 * Check if a user meets the minimum role requirement.
 * Returns { user } on success, or { error, status } on failure (401 or 403).
 */
export function requireRole(
  request: Request,
  minRole: User['role']
): { user: User; error?: never; status?: never } | { user?: never; error: string; status: 401 | 403 } {
  const user = getUserFromRequest(request)
  if (!user) {
    return { error: 'Authentication required', status: 401 }
  }
  if ((ROLE_LEVELS[user.role] ?? -1) < ROLE_LEVELS[minRole]) {
    return { error: `Requires ${minRole} role or higher`, status: 403 }
  }
  return { user }
}

function parseCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}
