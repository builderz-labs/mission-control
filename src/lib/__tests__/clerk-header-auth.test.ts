/**
 * Phase 3 BUILD D2-D6 — Clerk-header auth path in getUserFromRequest.
 *
 * Tests the new Clerk-header path added at the top of getUserFromRequest:
 *   - rejects cross-tenant org mismatch (logs critical security event)
 *   - returns User when org matches MC_CLERK_ORG_SLUG
 *   - falls through when CLERK_SECRET_KEY unset
 *   - falls through when headers missing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const logSecurityEventSpy = vi.fn()
const getDatabaseSpy = vi.fn()

vi.mock('@/lib/security-events', () => ({
  logSecurityEvent: (...args: unknown[]) => logSecurityEventSpy(...args),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: () => getDatabaseSpy(),
}))

vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn((p: string) => `hashed:${p}`),
  verifyPassword: vi.fn(() => false),
  verifyPasswordWithRehashCheck: vi.fn(() => ({ valid: false, needsRehash: false })),
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn() },
}))

// Import after mocks
import { getUserFromRequest } from '@/lib/auth'

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', { headers: new Headers(headers) })
}

function makeFakeDb(opts: {
  userRow?: { id: number; username: string; display_name: string; role: 'admin' | 'operator' | 'viewer'; workspace_id: number; tenant_id?: number; provider?: 'local' | 'google'; email?: string | null; avatar_url?: string | null; is_approved?: number; created_at?: number; updated_at?: number; last_login_at?: number | null } | null
  workspaceRow?: { id: number; tenant_id: number } | null
} = {}) {
  const userRow = opts.userRow ?? null
  const workspaceRow = opts.workspaceRow ?? { id: 1, tenant_id: 1 }
  return {
    prepare: vi.fn((sql: string) => ({
      get: vi.fn((..._args: unknown[]) => {
        const norm = sql.replace(/\s+/g, ' ').trim()
        if (norm.startsWith('SELECT u.id, u.username') || norm.startsWith('SELECT u.id, u.username, u.display_name')) {
          return userRow ?? undefined
        }
        if (norm.startsWith('SELECT id, tenant_id') || norm.startsWith('SELECT tenant_id')) {
          return workspaceRow ?? undefined
        }
        if (norm.includes("FROM settings WHERE key = 'security.api_key'")) {
          return undefined
        }
        return undefined
      }),
      run: vi.fn(),
      all: vi.fn(() => []),
    })),
  }
}

describe('Phase 3 D2-D6 — Clerk-header auth path', () => {
  const originalEnv = process.env

  beforeEach(() => {
    logSecurityEventSpy.mockClear()
    getDatabaseSpy.mockClear()
    process.env = { ...originalEnv }
    delete process.env.CLERK_SECRET_KEY
    delete process.env.MC_CLERK_ORG_SLUG
    delete process.env.MC_PROXY_AUTH_HEADER
    delete process.env.API_KEY
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('falls through (returns null) when CLERK_SECRET_KEY is unset, even with headers', () => {
    process.env.MC_CLERK_ORG_SLUG = 'ceremonia'
    getDatabaseSpy.mockReturnValue(makeFakeDb())
    const req = makeRequest({
      'x-clerk-user-email': 'a@b.com',
      'x-clerk-org-slug': 'ceremonia',
    })
    const user = getUserFromRequest(req)
    expect(user).toBeNull()
    expect(logSecurityEventSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'clerk_org_mismatch' }),
    )
  })

  it('falls through when CLERK enabled but no Clerk headers present', () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_xxx'
    process.env.MC_CLERK_ORG_SLUG = 'ceremonia'
    getDatabaseSpy.mockReturnValue(makeFakeDb())
    const req = makeRequest({})
    const user = getUserFromRequest(req)
    expect(user).toBeNull()
  })

  it('rejects cross-tenant org mismatch with critical security event', () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_xxx'
    process.env.MC_CLERK_ORG_SLUG = 'ceremonia'
    getDatabaseSpy.mockReturnValue(makeFakeDb())
    const req = makeRequest({
      'x-clerk-user-email': 'eve@evil.com',
      'x-clerk-org-slug': 'attacker-org',
    })
    const user = getUserFromRequest(req)
    expect(user).toBeNull()
    expect(logSecurityEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'clerk_org_mismatch',
        severity: 'critical',
        source: 'auth',
      }),
    )
  })

  it('returns user when org matches MC_CLERK_ORG_SLUG and user pre-exists', () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_xxx'
    process.env.MC_CLERK_ORG_SLUG = 'ceremonia'
    getDatabaseSpy.mockReturnValue(
      makeFakeDb({
        userRow: {
          id: 42,
          username: 'austin@ceremoniacircle.org',
          display_name: 'Austin',
          role: 'operator',
          workspace_id: 1,
          tenant_id: 1,
          provider: 'local',
          email: 'austin@ceremoniacircle.org',
          avatar_url: null,
          is_approved: 1,
          created_at: 0,
          updated_at: 0,
          last_login_at: null,
        },
      }),
    )
    const req = makeRequest({
      'x-clerk-user-email': 'austin@ceremoniacircle.org',
      'x-clerk-org-slug': 'ceremonia',
    })
    const user = getUserFromRequest(req)
    expect(user).not.toBeNull()
    expect(user!.username).toBe('austin@ceremoniacircle.org')
    expect(user!.role).toBe('operator')
  })

  it('rejects when MC_CLERK_ORG_SLUG set + org slug empty (missing org claim)', () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_xxx'
    process.env.MC_CLERK_ORG_SLUG = 'ceremonia'
    getDatabaseSpy.mockReturnValue(makeFakeDb())
    const req = makeRequest({
      'x-clerk-user-email': 'orphan@anywhere.com',
      // intentionally no x-clerk-org-slug
    })
    const user = getUserFromRequest(req)
    expect(user).toBeNull()
    expect(logSecurityEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'clerk_org_mismatch' }),
    )
  })

  it('allows when MC_CLERK_ORG_SLUG is empty (dev mode — no per-tenant gate)', () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_xxx'
    // MC_CLERK_ORG_SLUG intentionally unset → no org check
    getDatabaseSpy.mockReturnValue(
      makeFakeDb({
        userRow: {
          id: 7,
          username: 'dev@example.com',
          display_name: 'Dev',
          role: 'admin',
          workspace_id: 1,
          tenant_id: 1,
          provider: 'local',
          email: 'dev@example.com',
          avatar_url: null,
          is_approved: 1,
          created_at: 0,
          updated_at: 0,
          last_login_at: null,
        },
      }),
    )
    const req = makeRequest({
      'x-clerk-user-email': 'dev@example.com',
      'x-clerk-org-slug': 'whatever',
    })
    const user = getUserFromRequest(req)
    expect(user).not.toBeNull()
    expect(user!.username).toBe('dev@example.com')
    expect(logSecurityEventSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'clerk_org_mismatch' }),
    )
  })
})
