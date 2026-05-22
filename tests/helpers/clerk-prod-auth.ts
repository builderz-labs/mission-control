/**
 * Lane T3 — Backend JWT helper for prod Clerk testing.
 *
 * Mints a short-lived (60s) session JWT against the PROD Clerk instance
 * (`ins_3DaR5Y8`) by calling the Backend API directly. Use this when
 * driving prod E2E specs that need authenticated browser context against
 * `mc-{tenant}.holalumina.com`.
 *
 * Why Backend JWT vs OTP code 424242:
 *   Prod Clerk does NOT honor reserved fixture OTP `424242`. Per the
 *   clerk-testing skill v2.1.0: "Test fixtures and Testing Tokens work
 *   in production instances only via email-password or email-link flows
 *   — code-based methods (SMS OTP, email OTP) are not supported by
 *   testing helpers in production. Stick to dev instances for OTP-based
 *   E2E." Backend-API-minted JWTs work on both dev and prod.
 *
 * Gotcha: Clerk's `/v1/sessions` create does NOT honor `organization_id`.
 * The minted JWT carries the user's `last_active_organization_id` claim.
 * To switch active org for testing, PATCH `/v1/users/$USER_ID` with
 * `public_metadata.last_active_organization_id = <org_id>` BEFORE
 * minting the session. Without that PATCH, `o.id` + `o.slg` claims are
 * absent and `clerkAuth().orgId` is null → middleware 401s.
 *
 * Verified prod org slugs (LIVE Hetzner SSH probe + Clerk Backend API,
 * 2026-05-19) — supersede stale Session 4 memory which said
 * `lumina-openclaw`:
 *   mc-ceremonia  → MC_CLERK_ORG_SLUG=ceremonia
 *                   org_3DaTUQZasbliv1n4CqMH8911R0y
 *   mc-eric       → MC_CLERK_ORG_SLUG=ericedmeades
 *                   org_3DaTULtcSvuhChrKpeZ5daIVa4J
 *   mc-lumina     → MC_CLERK_ORG_SLUG=holalumina (NOT lumina-openclaw)
 *                   org_3DaTUWrD3Z3B5VdLTwCybwlZOz6
 *
 * Verified prod fixture user:
 *   austin@ceremoniacircle.org (user_3DaTOL7kXH6PmSswtcH7Zg1ATw7) is
 *   admin in all 3 prod orgs. (Session 4 memory claim that
 *   `qa+clerk_test@holalumina.com` exists is FALSE — was never created.)
 */
import { request } from '@playwright/test'

export interface ProdJwt {
  jwt: string
  userId: string
  orgId: string
  sessionId: string
  expiresInSec: number
}

export interface MintOpts {
  orgSlug: 'ceremonia' | 'ericedmeades' | 'holalumina'
  email: string
}

const PROD_ORG_IDS: Record<MintOpts['orgSlug'], string> = {
  ceremonia: 'org_3DaTUQZasbliv1n4CqMH8911R0y',
  ericedmeades: 'org_3DaTULtcSvuhChrKpeZ5daIVa4J',
  holalumina: 'org_3DaTUWrD3Z3B5VdLTwCybwlZOz6',
}

function requireClerkSecret(): string {
  const sk = process.env.CLERK_SECRET_KEY
  if (!sk || !sk.startsWith('sk_live_')) {
    throw new Error(
      'CLERK_SECRET_KEY missing or non-prod. Source via: ' +
      'doppler secrets get CLERK_SECRET_KEY --plain --config prd_live',
    )
  }
  return sk
}

async function clerkApi(): Promise<import('@playwright/test').APIRequestContext> {
  return request.newContext({
    baseURL: 'https://api.clerk.com',
    extraHTTPHeaders: {
      Authorization: `Bearer ${requireClerkSecret()}`,
      'Content-Type': 'application/json',
    },
  })
}

async function findUserIdByEmail(email: string): Promise<string> {
  const ctx = await clerkApi()
  const res = await ctx.get(`/v1/users?email_address=${encodeURIComponent(email)}`)
  if (!res.ok()) {
    throw new Error(`Clerk /v1/users lookup failed (${res.status()}): ${await res.text()}`)
  }
  const users = (await res.json()) as Array<{ id: string }>
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error(`Clerk user not found for email ${email}`)
  }
  return users[0].id
}

async function setActiveOrg(userId: string, orgId: string): Promise<void> {
  const ctx = await clerkApi()
  const res = await ctx.patch(`/v1/users/${userId}`, {
    data: { public_metadata: { last_active_organization_id: orgId } },
  })
  if (!res.ok()) {
    throw new Error(`PATCH last_active_organization_id failed (${res.status()}): ${await res.text()}`)
  }
}

async function createSessionAndToken(userId: string): Promise<{ sessionId: string; jwt: string }> {
  const ctx = await clerkApi()
  const sessRes = await ctx.post('/v1/sessions', { data: { user_id: userId } })
  if (!sessRes.ok()) {
    throw new Error(`session create failed (${sessRes.status()}): ${await sessRes.text()}`)
  }
  const sess = (await sessRes.json()) as { id: string }
  if (!sess?.id) throw new Error(`session create returned no id`)

  const tokRes = await ctx.post(`/v1/sessions/${sess.id}/tokens`, { data: {} })
  if (!tokRes.ok()) {
    throw new Error(`token mint failed (${tokRes.status()}): ${await tokRes.text()}`)
  }
  const tok = (await tokRes.json()) as { jwt: string }
  if (!tok?.jwt) throw new Error(`token mint returned no jwt`)
  return { sessionId: sess.id, jwt: tok.jwt }
}

/**
 * Mint a short-lived (60s) session JWT for prod Clerk usage in Playwright.
 *
 * Order of operations matters:
 *   1. Resolve user_id from email
 *   2. PATCH last_active_organization_id BEFORE creating session
 *      (without this, JWT has no o.id / o.slg claim)
 *   3. Create session
 *   4. Mint JWT against session
 */
export async function mintClerkProdJwt(opts: MintOpts): Promise<ProdJwt> {
  const orgId = PROD_ORG_IDS[opts.orgSlug]
  if (!orgId) throw new Error(`unknown prod org slug: ${opts.orgSlug}`)
  const userId = await findUserIdByEmail(opts.email)
  await setActiveOrg(userId, orgId)
  const { sessionId, jwt } = await createSessionAndToken(userId)
  return { jwt, userId, orgId, sessionId, expiresInSec: 60 }
}

/** Cookie domain scope shared across all `*.holalumina.com` MCs. */
export const SESSION_COOKIE_DOMAIN = '.holalumina.com'

/**
 * Fixture user — admin in all 3 prod orgs. Verified 2026-05-19.
 * (NOT qa+clerk_test@holalumina.com — that user never existed.)
 */
export const PROD_FIXTURE_EMAIL = 'austin@ceremoniacircle.org'

/**
 * MC subdomain → org slug map for use in cross-tenant specs.
 */
export const TENANT_SUBDOMAINS: Record<MintOpts['orgSlug'], string> = {
  ceremonia: 'mc-ceremonia.holalumina.com',
  ericedmeades: 'mc-eric.holalumina.com',
  holalumina: 'mc-lumina.holalumina.com',
}
