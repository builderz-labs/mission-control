/**
 * Lane T3 — SC2 proof: tab-switch OD `/design` ↔ MC `/ops` no re-auth.
 *
 * Mints a single prod Clerk JWT against the ceremonia org, sets it as
 * the `__session` cookie scoped to `.holalumina.com`, then navigates
 * BOTH `app.holalumina.com/design/ceremonia` (OD surface) AND
 * `mc-ceremonia.holalumina.com/ops` (MC surface) without re-auth.
 *
 * Both surfaces share Clerk instance `ins_3DaR5Y8` and the Frontend API
 * at `clerk.holalumina.com` issues session cookies scoped to the parent
 * domain, so a single sign-in covers every `*.holalumina.com` subdomain.
 *
 * Cost: $0 (no LLM call; pure auth + route check).
 *
 * Required env:
 *   CLERK_SECRET_KEY=sk_live_*  (Doppler prd_live)
 *
 * Skipped automatically when CLERK_SECRET_KEY missing (CI safety).
 */
import { expect, test } from '@playwright/test'

import {
  PROD_FIXTURE_EMAIL,
  SESSION_COOKIE_DOMAIN,
  mintClerkProdJwt,
} from './helpers/clerk-prod-auth'

test.describe('SC2 — Tab-switch OD↔MC no re-auth (ceremonia tenant)', () => {
  test.skip(!process.env.CLERK_SECRET_KEY, 'CLERK_SECRET_KEY required for prod Clerk JWT')

  test('signed-in session reaches both OD /design and MC /ops without re-auth', async ({ browser }) => {
    const { jwt } = await mintClerkProdJwt({
      orgSlug: 'ceremonia',
      email: PROD_FIXTURE_EMAIL,
    })

    const context = await browser.newContext()
    await context.addCookies([
      {
        name: '__session',
        value: jwt,
        domain: SESSION_COOKIE_DOMAIN,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ])

    const page = await context.newPage()

    // 1. Visit OD surface — should NOT redirect to sign-in
    const odResp = await page.goto('https://app.holalumina.com/design/ceremonia', {
      waitUntil: 'domcontentloaded',
    })
    expect(odResp?.status(), 'OD /design status').toBeLessThan(400)
    expect(page.url(), 'OD does NOT redirect to sign-in').not.toMatch(
      /accounts\.holalumina\.com\/sign-in/,
    )

    // 2. Navigate to MC surface in the same context — also no sign-in prompt
    const mcResp = await page.goto('https://mc-ceremonia.holalumina.com/ops', {
      waitUntil: 'domcontentloaded',
    })
    expect(mcResp?.status(), 'MC /ops status').toBeLessThan(400)
    expect(page.url(), 'MC does NOT redirect to sign-in').not.toMatch(
      /accounts\.holalumina\.com\/sign-in/,
    )

    // 3. Backend API check — MC's /api/auth/me returns 200 + correct email
    const apiRes = await context.request.get('https://mc-ceremonia.holalumina.com/api/auth/me')
    expect(apiRes.status()).toBe(200)
    const json = await apiRes.json()
    expect(json.user?.email).toBe(PROD_FIXTURE_EMAIL)

    await context.close()
  })
})
