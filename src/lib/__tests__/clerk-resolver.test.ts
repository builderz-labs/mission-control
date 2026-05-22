import { describe, it, expect, vi } from 'vitest'
import {
  resolveClerkJwt,
  getClerkConfigFromEnv,
  type ClerkResolverConfig,
  type ClerkTokenVerifier,
} from '@/lib/clerk-resolver'

const baseCfg: ClerkResolverConfig = {
  publishableKey: 'pk_test_dummy',
  secretKey: 'sk_test_dummy',
  expectedAudience: 'mission-control',
}

describe('resolveClerkJwt', () => {
  it('returns a shaped user when verifier yields valid claims', async () => {
    const verifier: ClerkTokenVerifier = vi.fn(async () => ({
      sub: 'user_abc',
      o: { id: 'org_xyz', slg: 'ceremonia' },
      email: 'austin@ceremonia.app',
      exp: 1_700_000_000,
    }))
    const result = await resolveClerkJwt('token.body.sig', baseCfg, { verifier })
    expect(result).toEqual({
      clerkUserId: 'user_abc',
      clerkOrgId: 'org_xyz',
      clerkOrgSlug: 'ceremonia',
      email: 'austin@ceremonia.app',
      expiresAt: 1_700_000_000,
    })
    expect(verifier).toHaveBeenCalledWith('token.body.sig', {
      secretKey: 'sk_test_dummy',
      jwtKey: undefined,
      audience: 'mission-control',
    })
  })

  it('returns null when verifier throws (expired/wrong audience/etc.)', async () => {
    const verifier: ClerkTokenVerifier = vi.fn(async () => {
      throw new Error('Token expired')
    })
    const result = await resolveClerkJwt('expired.token', baseCfg, { verifier })
    expect(result).toBeNull()
  })

  it('returns null when token is empty', async () => {
    const verifier: ClerkTokenVerifier = vi.fn()
    const result = await resolveClerkJwt('', baseCfg, { verifier })
    expect(result).toBeNull()
    expect(verifier).not.toHaveBeenCalled()
  })

  it('returns null when secretKey is missing', async () => {
    const verifier: ClerkTokenVerifier = vi.fn()
    const result = await resolveClerkJwt('t', { ...baseCfg, secretKey: '' }, { verifier })
    expect(result).toBeNull()
    expect(verifier).not.toHaveBeenCalled()
  })

  it('returns null when verifier yields a malformed payload (missing sub)', async () => {
    const verifier: ClerkTokenVerifier = vi.fn(async () => ({
      o: { id: 'org_xyz', slg: 'ceremonia' },
      email: 'a@b.com',
    }))
    const result = await resolveClerkJwt('t', baseCfg, { verifier })
    expect(result).toBeNull()
  })

  it('handles missing org claim gracefully (null orgId/orgSlug)', async () => {
    const verifier: ClerkTokenVerifier = vi.fn(async () => ({
      sub: 'user_solo',
      email: 'solo@example.com',
      exp: 1_700_000_000,
    }))
    const result = await resolveClerkJwt('t', baseCfg, { verifier })
    expect(result).toEqual({
      clerkUserId: 'user_solo',
      clerkOrgId: null,
      clerkOrgSlug: null,
      email: 'solo@example.com',
      expiresAt: 1_700_000_000,
    })
  })

  it('handles missing email (null) without breaking', async () => {
    const verifier: ClerkTokenVerifier = vi.fn(async () => ({
      sub: 'user_no_email',
      o: { id: 'org_x', slg: 'tenant' },
    }))
    const result = await resolveClerkJwt('t', baseCfg, { verifier })
    expect(result?.email).toBeNull()
    expect(result?.expiresAt).toBeNull()
  })

  it('rejects non-string token input', async () => {
    const verifier: ClerkTokenVerifier = vi.fn()
    // @ts-expect-error testing runtime guard
    const result = await resolveClerkJwt(123, baseCfg, { verifier })
    expect(result).toBeNull()
  })
})

describe('getClerkConfigFromEnv', () => {
  it('returns null when CLERK_SECRET_KEY is unset', () => {
    expect(getClerkConfigFromEnv({})).toBeNull()
  })

  it('returns null when CLERK_SECRET_KEY is blank/whitespace', () => {
    expect(getClerkConfigFromEnv({ CLERK_SECRET_KEY: '   ' })).toBeNull()
  })

  it('returns config when CLERK_SECRET_KEY is present', () => {
    const cfg = getClerkConfigFromEnv({
      CLERK_SECRET_KEY: 'sk_live_xyz',
      CLERK_PUBLISHABLE_KEY: 'pk_live_xyz',
      CLERK_JWT_AUDIENCE: 'mc',
    })
    expect(cfg).toEqual({
      publishableKey: 'pk_live_xyz',
      secretKey: 'sk_live_xyz',
      jwtKey: undefined,
      expectedAudience: 'mc',
    })
  })

  it('passes jwtKey through when set', () => {
    const cfg = getClerkConfigFromEnv({
      CLERK_SECRET_KEY: 'sk_x',
      CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----\nABC\n-----END PUBLIC KEY-----',
    })
    expect(cfg?.jwtKey).toContain('BEGIN PUBLIC KEY')
  })
})
