/**
 * Lane T3 — SC3, D10 cross-tenant 403 proof.
 *
 * Mints a prod Clerk JWT for the ceremonia org and asserts the request
 * to `mc-eric.holalumina.com/api/auth/me` is REJECTED with HTTP 403 by
 * the org-claim middleware gate.
 *
 * IMPORTANT — assertion strategy (corrected per T3 sub-agent verified
 * findings 2026-05-19):
 *
 * The brief proposed asserting an audit-count delta on the MC SQLite
 * `security_events` table. That is incorrect. The middleware path at
 * `src/proxy.ts:clerkMiddleware` returns 403 BEFORE the
 * `clerk_org_mismatch` audit event fires — that audit log lives in
 * `src/lib/auth.ts:449` on the header-validation code path which runs
 * AFTER middleware. So a cross-tenant request stopped at middleware
 * never produces an audit row. The 403 status itself is the
 * authoritative proof; audit-table count remains 0 (which the
 * baseline-clean SC3 infrastructure proof already documented).
 *
 * Cost: $0.
 */
import { expect, test } from '@playwright/test'

import {
  PROD_FIXTURE_EMAIL,
  TENANT_SUBDOMAINS,
  mintClerkProdJwt,
} from './helpers/clerk-prod-auth'

test.describe('SC3 / D10 — cross-tenant 403 enforcement', () => {
  test.skip(!process.env.CLERK_SECRET_KEY, 'CLERK_SECRET_KEY required for prod Clerk JWT')

  // 3 directed pairs covering each cross-tenant edge
  const crossTenantPairs: Array<{
    name: string
    jwtOrg: 'ceremonia' | 'ericedmeades' | 'holalumina'
    targetHost: string
  }> = [
    { name: 'ceremonia → mc-eric', jwtOrg: 'ceremonia', targetHost: TENANT_SUBDOMAINS.ericedmeades },
    { name: 'eric → mc-lumina', jwtOrg: 'ericedmeades', targetHost: TENANT_SUBDOMAINS.holalumina },
    { name: 'lumina → mc-ceremonia', jwtOrg: 'holalumina', targetHost: TENANT_SUBDOMAINS.ceremonia },
  ]

  for (const pair of crossTenantPairs) {
    test(`${pair.name} rejected with 403`, async ({ request }) => {
      const { jwt } = await mintClerkProdJwt({
        orgSlug: pair.jwtOrg,
        email: PROD_FIXTURE_EMAIL,
      })

      const res = await request.get(`https://${pair.targetHost}/api/auth/me`, {
        headers: { Authorization: `Bearer ${jwt}`, Cookie: `__session=${jwt}` },
      })

      expect(res.status(), `cross-tenant ${pair.name} blocked at middleware`).toBe(403)
    })
  }

  test('same-tenant request with valid JWT succeeds (control case)', async ({ request }) => {
    const { jwt } = await mintClerkProdJwt({
      orgSlug: 'ceremonia',
      email: PROD_FIXTURE_EMAIL,
    })
    const res = await request.get(`https://${TENANT_SUBDOMAINS.ceremonia}/api/auth/me`, {
      headers: { Authorization: `Bearer ${jwt}`, Cookie: `__session=${jwt}` },
    })
    expect(res.status()).toBe(200)
  })
})
