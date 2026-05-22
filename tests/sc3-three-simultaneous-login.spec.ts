/**
 * Lane T3 — SC3 proof: 3 tenants logged in simultaneously, zero
 * cross-tenant reads.
 *
 * Mints 3 prod Clerk JWTs in parallel (ceremonia, ericedmeades,
 * holalumina) — each with the same fixture user `austin@ceremoniacircle.org`
 * who is admin in all 3 orgs but holds DIFFERENT
 * `last_active_organization_id` between mints.
 *
 * Each context navigates ONLY to its own MC; queries each MC's
 * `/api/auth/me` to verify the session resolves correctly, and
 * separately probes the WRONG MC to assert 403 → no cross-tenant read.
 *
 * Cost: $0.
 *
 * NOTE: Because all 3 JWTs are issued against the same Clerk user,
 * Clerk's `last_active_organization_id` is overwritten by each
 * subsequent mint. We mint serially per-tenant (NOT parallel) so that
 * the JWT captured for tenant N carries that tenant's org claim. The
 * "simultaneous" requirement is satisfied at the BROWSER context level —
 * 3 contexts in flight at the same time — not at the JWT-mint level.
 */
import { expect, test } from '@playwright/test'

import {
  PROD_FIXTURE_EMAIL,
  TENANT_SUBDOMAINS,
  mintClerkProdJwt,
} from './helpers/clerk-prod-auth'

const TENANTS: Array<{
  slug: 'ceremonia' | 'ericedmeades' | 'holalumina'
  host: string
}> = [
  { slug: 'ceremonia', host: TENANT_SUBDOMAINS.ceremonia },
  { slug: 'ericedmeades', host: TENANT_SUBDOMAINS.ericedmeades },
  { slug: 'holalumina', host: TENANT_SUBDOMAINS.holalumina },
]

test.describe('SC3 — 3 simultaneous tenant logins, zero cross-tenant reads', () => {
  test.skip(!process.env.CLERK_SECRET_KEY, 'CLERK_SECRET_KEY required for prod Clerk JWT')

  test('each tenant context reads own MC only; cross-tenant probes return 403', async ({ browser }) => {
    // Step 1: mint JWTs serially (Clerk last_active_organization_id gets
    // overwritten per mint; we need each JWT to carry its target tenant)
    const minted: Array<{ slug: string; host: string; jwt: string }> = []
    for (const t of TENANTS) {
      const { jwt } = await mintClerkProdJwt({ orgSlug: t.slug, email: PROD_FIXTURE_EMAIL })
      minted.push({ slug: t.slug, host: t.host, jwt })
    }

    // Step 2: spin up 3 browser contexts in parallel (simultaneous sessions)
    const contexts = await Promise.all(
      minted.map(async ({ host, jwt }) => {
        const ctx = await browser.newContext()
        await ctx.addCookies([
          {
            name: '__session',
            value: jwt,
            domain: '.holalumina.com',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
          },
        ])
        return { ctx, host, jwt }
      }),
    )

    // Step 3: each context calls /api/auth/me on its OWN MC — expect 200
    const ownSurfaceResults = await Promise.all(
      contexts.map(async ({ ctx, host }) => {
        const res = await ctx.request.get(`https://${host}/api/auth/me`)
        return { host, status: res.status() }
      }),
    )
    for (const r of ownSurfaceResults) {
      expect(r.status, `own surface mc-${r.host} should resolve`).toBe(200)
    }

    // Step 4: cross-tenant probes — each context tries the OTHER 2 MCs.
    // Expect 403 from every cross-tenant request.
    type CrossProbe = { jwtSlug: string; targetHost: string; status: number }
    const crossProbes: CrossProbe[] = []
    for (const { jwt } of contexts) {
      for (const target of TENANTS) {
        const jwtSlug = contexts.find((c) => c.jwt === jwt)?.host
        if (jwtSlug === target.host) continue
        const probeCtx = await browser.newContext({
          extraHTTPHeaders: { Authorization: `Bearer ${jwt}`, Cookie: `__session=${jwt}` },
        })
        const res = await probeCtx.request.get(`https://${target.host}/api/auth/me`)
        crossProbes.push({ jwtSlug: jwtSlug ?? '?', targetHost: target.host, status: res.status() })
        await probeCtx.close()
      }
    }

    for (const probe of crossProbes) {
      expect(probe.status, `${probe.jwtSlug} → ${probe.targetHost} must be 403`).toBe(403)
    }

    // Step 5: cleanup
    await Promise.all(contexts.map((c) => c.ctx.close()))
  })
})
