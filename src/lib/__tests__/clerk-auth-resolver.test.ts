import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ getDatabase: vi.fn() }))
vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(() => false),
  verifyPasswordWithRehashCheck: vi.fn(() => ({ ok: false })),
}))
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn() },
}))
vi.mock('@/lib/security-events', () => ({
  logSecurityEvent: vi.fn(),
}))
vi.mock('@/lib/request', () => ({
  extractClientIpFromTrusted: vi.fn(() => null),
}))
vi.mock('@/lib/session-cookie', () => ({
  parseMcSessionCookieHeader: vi.fn(() => null),
}))

import {
  mapToMcUser,
  registerClerkResolver,
  resolveClerkUser,
} from '@/lib/clerk-auth-resolver'
import type { ResolvedClerkUser } from '@/lib/clerk-resolver'

const validClaims: ResolvedClerkUser = {
  clerkUserId: 'user_abc',
  clerkOrgId: 'org_xyz',
  clerkOrgSlug: 'ceremonia',
  email: 'austin@ceremonia.app',
  expiresAt: 1_700_000_000,
}

const cfg = {
  publishableKey: 'pk_test',
  secretKey: 'sk_test',
  expectedAudience: 'mission-control',
}
const map = {
  ceremonia: { tenantId: 1, workspaceId: 1 },
  eric: { tenantId: 2, workspaceId: 4 },
}

describe('mapToMcUser', () => {
  it('produces a User shape with tenant binding wired in', () => {
    const user = mapToMcUser(validClaims, map.ceremonia, 'agent-1')
    expect(user.id).toBe(0)
    expect(user.username).toBe('austin@ceremonia.app')
    expect(user.tenant_id).toBe(1)
    expect(user.workspace_id).toBe(1)
    expect(user.role).toBe('operator')
    expect(user.provider).toBe('proxy')
    expect(user.email).toBe('austin@ceremonia.app')
    expect(user.agent_name).toBe('agent-1')
  })

  it('falls back to clerkUserId as username when email is null', () => {
    const user = mapToMcUser({ ...validClaims, email: null }, map.ceremonia)
    expect(user.username).toBe('user_abc')
    expect(user.email).toBeNull()
  })

  it('binds workspace/tenant from the supplied binding', () => {
    const user = mapToMcUser(validClaims, map.eric)
    expect(user.tenant_id).toBe(2)
    expect(user.workspace_id).toBe(4)
  })
})

describe('resolveClerkUser', () => {
  it('returns null when no config', async () => {
    const prev = process.env.CLERK_SECRET_KEY
    delete process.env.CLERK_SECRET_KEY
    try {
      const user = await resolveClerkUser('t', null, {})
      expect(user).toBeNull()
    } finally {
      if (prev !== undefined) process.env.CLERK_SECRET_KEY = prev
    }
  })

  it('returns null when apiKey is empty', async () => {
    const user = await resolveClerkUser('', null, {
      config: cfg,
      orgTenantMap: map,
      resolveOptions: { verifier: vi.fn(async () => validClaims as unknown as Record<string, unknown>) },
    })
    expect(user).toBeNull()
  })

  it('returns null when JWT verification fails', async () => {
    const verifier = vi.fn(async () => {
      throw new Error('bad sig')
    })
    const user = await resolveClerkUser('t', null, {
      config: cfg,
      orgTenantMap: map,
      resolveOptions: { verifier },
    })
    expect(user).toBeNull()
  })

  it('returns null when org claim is missing (default fail-closed)', async () => {
    const verifier = vi.fn(async () => ({
      sub: 'user_x',
      email: 'a@b.com',
    }))
    const user = await resolveClerkUser('t', null, {
      config: cfg,
      orgTenantMap: map,
      resolveOptions: { verifier },
    })
    expect(user).toBeNull()
  })

  it('returns null when org slug is unknown (multi-tenant safety)', async () => {
    const verifier = vi.fn(async () => ({
      sub: 'user_x',
      o: { id: 'org_unknown', slg: 'not-a-tenant' },
      email: 'a@b.com',
    }))
    const user = await resolveClerkUser('t', null, {
      config: cfg,
      orgTenantMap: map,
      resolveOptions: { verifier },
    })
    expect(user).toBeNull()
  })

  it('maps to MC user when org slug matches', async () => {
    const verifier = vi.fn(async () => ({
      sub: 'user_abc',
      o: { id: 'org_xyz', slg: 'ceremonia' },
      email: 'austin@ceremonia.app',
      exp: 1_700_000_000,
    }))
    const user = await resolveClerkUser('t', 'my-agent', {
      config: cfg,
      orgTenantMap: map,
      resolveOptions: { verifier },
    })
    expect(user).not.toBeNull()
    expect(user?.tenant_id).toBe(1)
    expect(user?.workspace_id).toBe(1)
    expect(user?.agent_name).toBe('my-agent')
    expect(user?.email).toBe('austin@ceremonia.app')
  })

  it('uses dev fallback binding when allowOrglessJwt is true', async () => {
    const verifier = vi.fn(async () => ({ sub: 'user_solo' }))
    const user = await resolveClerkUser('t', null, {
      config: cfg,
      orgTenantMap: { default: { tenantId: 9, workspaceId: 9 } },
      resolveOptions: { verifier },
      allowOrglessJwt: true,
    })
    expect(user?.tenant_id).toBe(9)
    expect(user?.workspace_id).toBe(9)
  })

  it('still rejects orgless JWT when allowOrglessJwt is false (default)', async () => {
    const verifier = vi.fn(async () => ({ sub: 'user_solo' }))
    const user = await resolveClerkUser('t', null, {
      config: cfg,
      orgTenantMap: map,
      resolveOptions: { verifier },
    })
    expect(user).toBeNull()
  })
})

describe('registerClerkResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns false (no-op) when no config available', () => {
    const registrar = vi.fn()
    // Stub env: scrub all CLERK_* keys for this test
    const prev = process.env.CLERK_SECRET_KEY
    delete process.env.CLERK_SECRET_KEY
    try {
      const ok = registerClerkResolver({ registrar })
      expect(ok).toBe(false)
      expect(registrar).not.toHaveBeenCalled()
    } finally {
      if (prev !== undefined) process.env.CLERK_SECRET_KEY = prev
    }
  })

  it('registers a hook and returns true when config present', () => {
    const registrar = vi.fn()
    const ok = registerClerkResolver({ config: cfg, registrar, orgTenantMap: map })
    expect(ok).toBe(true)
    expect(registrar).toHaveBeenCalledTimes(1)
    const hook = registrar.mock.calls[0][0]
    expect(typeof hook).toBe('function')
  })

  it('registered sync hook is a no-op (scaffold contract)', () => {
    const registrar = vi.fn()
    registerClerkResolver({ config: cfg, registrar, orgTenantMap: map })
    const hook = registrar.mock.calls[0][0]
    // Scaffold: the sync hook is a placeholder. Real auth flows through
    // the async `resolveClerkUser` once wired via middleware at cutover.
    expect(hook('any-token', null)).toBeNull()
  })
})
