import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { runMigrations } from '@/lib/migrations'
import { requireRole } from '@/lib/auth'
import { GET, POST } from '@/app/api/tokens/rotate/route'

/**
 * Security fix S1: the dashboard-rotated global API key must be stored as a
 * SHA-256 hash (settings 'security.api_key_hash'), never in plaintext.
 * The plaintext key is returned exactly once, in the rotation response.
 *
 * Uses a real in-memory SQLite database with the production migrations.
 */

let db: InstanceType<typeof Database>

vi.mock('@/lib/db', () => ({
  getDatabase: () => db,
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn((p: string) => `hashed:${p}`),
  verifyPassword: vi.fn(() => false),
  verifyPasswordWithRehashCheck: vi.fn(() => ({ valid: false, needsRehash: false })),
}))

// Prevent event-bus singleton side-effects
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn() },
}))

vi.mock('@/lib/security-events', () => ({
  logSecurityEvent: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  identitySecurityMutationLimiter: vi.fn(() => null),
}))

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function makeRequest(headers: Record<string, string> = {}, method = 'GET'): Request {
  return new Request('http://localhost/api/tokens/rotate', {
    method,
    headers: new Headers(headers),
  })
}

function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

const originalEnv = process.env

beforeEach(() => {
  process.env = { ...originalEnv, API_KEY: 'bootstrap-env-key' }
  db = new Database(':memory:')
  runMigrations(db)
})

afterEach(() => {
  process.env = originalEnv
  db?.close()
})

describe('POST /api/tokens/rotate (hash at rest)', () => {
  it('stores only the sha256 hash of the new key, never the plaintext', async () => {
    const res = await POST(makeRequest({ 'x-api-key': 'bootstrap-env-key' }, 'POST') as any)
    expect(res.status).toBe(200)
    const data = await res.json()

    // Response returns the plaintext key exactly once, same shape as before
    expect(data.key).toMatch(/^mc_[0-9a-f]{48}$/)
    expect(data.masked_key).toContain('****')
    expect(data.rotated_by).toBe('api')

    // Only the hash is at rest; no plaintext row remains
    expect(getSetting('security.api_key_hash')).toBe(sha256Hex(data.key))
    expect(getSetting('security.api_key')).toBeUndefined()

    // The plaintext key does not appear anywhere in the settings table
    const allValues = (db.prepare('SELECT value FROM settings').all() as Array<{ value: string }>)
      .map((r) => r.value)
    expect(allValues).not.toContain(data.key)
  })

  it('deletes a legacy plaintext security.api_key row on rotation', async () => {
    db.prepare(`
      INSERT INTO settings (key, value, category) VALUES ('security.api_key', 'mc_legacyplaintextkey123', 'security')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run()

    const res = await POST(makeRequest({ 'x-api-key': 'mc_legacyplaintextkey123' }, 'POST') as any)
    expect(res.status).toBe(200)
    const data = await res.json()

    expect(getSetting('security.api_key')).toBeUndefined()
    expect(getSetting('security.api_key_hash')).toBe(sha256Hex(data.key))
  })

  it('the returned plaintext key authenticates as admin via the hash path', async () => {
    const res = await POST(makeRequest({ 'x-api-key': 'bootstrap-env-key' }, 'POST') as any)
    const data = await res.json()

    const auth = requireRole(makeRequest({ 'x-api-key': data.key }), 'admin')
    expect(auth.error).toBeUndefined()
    expect(auth.user).toBeDefined()
    expect(auth.user!.username).toBe('api')
    expect(auth.user!.role).toBe('admin')
  })

  it('rejects wrong keys and the old env key once a DB hash is set', async () => {
    const res = await POST(makeRequest({ 'x-api-key': 'bootstrap-env-key' }, 'POST') as any)
    const data = await res.json()
    expect(data.key).toBeDefined()

    // Wrong key
    const wrong = requireRole(makeRequest({ 'x-api-key': 'mc_' + '0'.repeat(48) }), 'viewer')
    expect(wrong.status).toBe(401)
    expect(wrong.user).toBeUndefined()

    // Presenting the raw hash itself must not work either
    const hash = getSetting('security.api_key_hash')!
    const viaHash = requireRole(makeRequest({ 'x-api-key': hash }), 'viewer')
    expect(viaHash.status).toBe(401)

    // DB key overrides env: old env key no longer authenticates
    const env = requireRole(makeRequest({ 'x-api-key': 'bootstrap-env-key' }), 'viewer')
    expect(env.status).toBe(401)
  })
})

describe('GET /api/tokens/rotate (metadata only)', () => {
  it('reports configured without exposing key material for DB-stored keys', async () => {
    const rotateRes = await POST(makeRequest({ 'x-api-key': 'bootstrap-env-key' }, 'POST') as any)
    const { key } = await rotateRes.json()

    const res = await GET(makeRequest({ 'x-api-key': key }) as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.source).toBe('database')
    expect(data.configured).toBe(true)
    expect(data.masked_key).toBeNull()
    expect(data.last_rotated_by).toBe('api')
  })

  it('still masks the env key when no DB key is stored', async () => {
    const res = await GET(makeRequest({ 'x-api-key': 'bootstrap-env-key' }) as any)
    const data = await res.json()
    expect(data.source).toBe('environment')
    expect(data.configured).toBe(true)
    expect(data.masked_key).toContain('****')
  })
})

describe('legacy plaintext fallback in auth', () => {
  it('accepts a plaintext security.api_key row only while no hash row exists', () => {
    db.prepare(`
      INSERT INTO settings (key, value, category) VALUES ('security.api_key', 'mc_legacyplaintextkey123', 'security')
    `).run()

    const ok = requireRole(makeRequest({ 'x-api-key': 'mc_legacyplaintextkey123' }), 'admin')
    expect(ok.user).toBeDefined()
    expect(ok.user!.role).toBe('admin')

    // Once a hash row exists, the hash row wins and the stale plaintext value is ignored
    db.prepare(`
      INSERT INTO settings (key, value, category) VALUES ('security.api_key_hash', ?, 'security')
    `).run(sha256Hex('mc_currentkey456'))

    const stale = requireRole(makeRequest({ 'x-api-key': 'mc_legacyplaintextkey123' }), 'viewer')
    expect(stale.status).toBe(401)

    const current = requireRole(makeRequest({ 'x-api-key': 'mc_currentkey456' }), 'viewer')
    expect(current.user).toBeDefined()
  })
})

describe('migration 051_hash_global_api_key', () => {
  it('converts an existing plaintext key to a sha256 hash and removes the plaintext row', () => {
    // Simulate a pre-migration database: re-insert the plaintext row and
    // un-apply 051 so the real migration runner re-runs it.
    db.prepare(`
      INSERT INTO settings (key, value, category, updated_by, updated_at)
      VALUES ('security.api_key', 'mc_oldplaintextsecret', 'security', 'alice', 1234567890)
    `).run()
    db.prepare("DELETE FROM schema_migrations WHERE id = '051_hash_global_api_key'").run()

    runMigrations(db)

    expect(getSetting('security.api_key')).toBeUndefined()
    expect(getSetting('security.api_key_hash')).toBe(sha256Hex('mc_oldplaintextsecret'))

    // Rotation metadata is preserved
    const row = db.prepare(
      "SELECT updated_by, updated_at FROM settings WHERE key = 'security.api_key_hash'"
    ).get() as { updated_by: string | null; updated_at: number }
    expect(row.updated_by).toBe('alice')
    expect(row.updated_at).toBe(1234567890)

    // The converted key still authenticates
    const auth = requireRole(makeRequest({ 'x-api-key': 'mc_oldplaintextsecret' }), 'admin')
    expect(auth.user).toBeDefined()
  })

  it('is a no-op when no plaintext key exists', () => {
    db.prepare("DELETE FROM schema_migrations WHERE id = '051_hash_global_api_key'").run()
    runMigrations(db)
    expect(getSetting('security.api_key')).toBeUndefined()
    expect(getSetting('security.api_key_hash')).toBeUndefined()
  })
})
