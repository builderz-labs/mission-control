/**
 * Lane T3 — Phase 3 D6 Clerk webhook revoke E2E.
 *
 * Posts a Svix-signed `session.revoked` payload to
 * `mc-ceremonia.holalumina.com/api/auth/clerk/webhook` and asserts:
 *   - 200 response from webhook handler
 *   - subsequent `/api/auth/me` request with the revoked Bearer
 *     returns 401 (sessions destroyed)
 *
 * Webhook signing requires `CLERK_WEBHOOK_SIGNING_SECRET` from Doppler
 * `prd_live` config. When missing, this spec is skipped (NOT failed)
 * because the underlying unit tests at
 * `src/app/api/auth/clerk/webhook/__tests__/route.test.ts` already cover
 * 7 webhook scenarios including valid signature + revoke path. The
 * E2E adds value by exercising the live MC's deployed webhook route
 * with a real prod Clerk-issued signature.
 *
 * Cost: $0.
 *
 * NOTE on signing: Svix library expects body string + headers
 * `svix-id`, `svix-timestamp`, `svix-signature`. We sign locally using
 * the shared secret from Doppler and the same algorithm Clerk uses
 * (HMAC-SHA256). Spec keeps the secret in-memory only.
 */
import { createHmac } from 'crypto'
import { expect, test } from '@playwright/test'

import {
  PROD_FIXTURE_EMAIL,
  TENANT_SUBDOMAINS,
  mintClerkProdJwt,
} from './helpers/clerk-prod-auth'

function signSvix(body: string, secret: string): { id: string; timestamp: string; signature: string } {
  const id = `msg_test_${Date.now()}`
  const timestamp = String(Math.floor(Date.now() / 1000))
  const toSign = `${id}.${timestamp}.${body}`
  // Svix secret prefix: whsec_<base64>
  const rawSecret = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice(6), 'base64')
    : Buffer.from(secret)
  const sig = createHmac('sha256', rawSecret).update(toSign).digest('base64')
  return { id, timestamp, signature: `v1,${sig}` }
}

test.describe('Phase 3 D6 — Clerk webhook session.revoked → /api/auth/me 401', () => {
  test.skip(!process.env.CLERK_SECRET_KEY, 'CLERK_SECRET_KEY required')
  test.skip(
    !process.env.CLERK_WEBHOOK_SIGNING_SECRET,
    'CLERK_WEBHOOK_SIGNING_SECRET required; unit tests cover signing path absent live secret',
  )

  test('valid session.revoked webhook revokes session, subsequent /api/auth/me returns 401', async ({ request }) => {
    // Step 1: mint a Bearer JWT for fixture user against ceremonia org
    const { jwt, userId, sessionId } = await mintClerkProdJwt({
      orgSlug: 'ceremonia',
      email: PROD_FIXTURE_EMAIL,
    })

    // Step 2: confirm /api/auth/me returns 200 (baseline)
    const preRes = await request.get(`https://${TENANT_SUBDOMAINS.ceremonia}/api/auth/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    expect(preRes.status(), 'baseline /api/auth/me must be 200').toBe(200)

    // Step 3: POST Svix-signed session.revoked event
    const eventBody = JSON.stringify({
      type: 'session.revoked',
      data: { id: sessionId, user_id: userId },
    })
    const svix = signSvix(eventBody, process.env.CLERK_WEBHOOK_SIGNING_SECRET!)
    const hookRes = await request.post(`https://${TENANT_SUBDOMAINS.ceremonia}/api/auth/clerk/webhook`, {
      data: eventBody,
      headers: {
        'svix-id': svix.id,
        'svix-timestamp': svix.timestamp,
        'svix-signature': svix.signature,
        'Content-Type': 'application/json',
      },
    })
    expect([200, 202], 'webhook accepts signed revoke').toContain(hookRes.status())

    // Step 4: same Bearer → /api/auth/me now returns 401 (sessions destroyed)
    // Note: there's a brief propagation window; allow up to 5s.
    let postStatus = 0
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await request.get(`https://${TENANT_SUBDOMAINS.ceremonia}/api/auth/me`, {
        headers: { Authorization: `Bearer ${jwt}` },
      })
      postStatus = r.status()
      if (postStatus === 401) break
      await new Promise((res) => setTimeout(res, 1000))
    }
    expect(postStatus, 'revoked session → /api/auth/me 401').toBe(401)
  })
})
