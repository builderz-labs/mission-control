/**
 * Lane T3 — Phase 3 D6 Clerk cutover proof.
 *
 * Verifies all 3 `mc-{tenant}.holalumina.com` redirect unauthenticated
 * requests to `accounts.holalumina.com/sign-in?...`. This proves the
 * Clerk middleware shipped in Session 4 (`lumina-phase-3-canary-*`
 * digest `sha256:52b2a9a18087`) is the auth surface and CF Access has
 * been fully cut over per D6 ("clean cutover per tenant").
 *
 * Cost: $0 (no auth, no LLM, just HTTP probe).
 */
import { expect, test } from '@playwright/test'

import { TENANT_SUBDOMAINS } from './helpers/clerk-prod-auth'

test.describe('Phase 3 D6 — Clerk sign-in cutover (all 3 MCs)', () => {
  for (const [slug, host] of Object.entries(TENANT_SUBDOMAINS)) {
    test(`mc-${slug} (${host}) redirects unauth to accounts.holalumina.com`, async ({ request }) => {
      const res = await request.get(`https://${host}/`, { maxRedirects: 0 })
      // Clerk middleware emits 307 (preferred) or 302 to the hosted sign-in URL
      expect([302, 307]).toContain(res.status())
      const loc = res.headers()['location']
      expect(loc).toBeTruthy()
      expect(loc).toMatch(/^https:\/\/accounts\.holalumina\.com\/sign-in/)
      // Clerk middleware diagnostic header confirms middleware (not Caddy/fallback)
      const reason = res.headers()['x-clerk-auth-reason']
      expect(reason).toBe('session-token-and-uat-missing')
    })
  }

  test('all 3 MCs redirect to IDENTICAL accounts.holalumina.com/sign-in URL', async ({ request }) => {
    const locs = await Promise.all(
      Object.values(TENANT_SUBDOMAINS).map(async (host) => {
        const res = await request.get(`https://${host}/`, { maxRedirects: 0 })
        // strip the redirect_url query (varies per host) to compare base path only
        const loc = res.headers()['location'] || ''
        return loc.split('?')[0]
      }),
    )
    const unique = Array.from(new Set(locs))
    expect(unique).toEqual(['https://accounts.holalumina.com/sign-in'])
  })
})
