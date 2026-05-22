/**
 * MC Phase 1 — Cross-tenant 403 E2E (T7) — EXTENDED for Clerk cutover.
 *
 * Source: T7 (eng-review JSONL) + D10 — silent failure mode if isolation
 * misconfigured.
 *
 * History:
 *   - Phase 1 original: CF Access service-token auth per tenant.
 *   - Phase 3 cutover (Session 4, 2026-05-19): CF Access apps DELETED
 *     (241810bb, e2cc1284, e75517c4). Clerk org-slug middleware gate is
 *     now the sole tenant-isolation primitive at the edge.
 *
 * This file preserves the original CF Access block (auto-skipped now that
 * CF tokens are not provisioned — the env vars will be undefined and the
 * `authHeaders` throws → test fails fast). The NEW describe block below
 * exercises the Clerk-era D10 path against the same 3 MCs.
 *
 * Verifies per-tenant MC isolation (Clerk era):
 *   1. Unauthenticated request to any mc-* → 307 to accounts.holalumina.com/sign-in
 *   2. Authenticated for tenant A CAN reach mc-A
 *   3. Authenticated for tenant A CANNOT reach mc-B (Clerk org-claim mismatch → 403)
 *
 * Phase 1 exit gate D10. Failure = HARD STOP.
 */

import { test, expect, request } from '@playwright/test';

import {
  PROD_FIXTURE_EMAIL,
  TENANT_SUBDOMAINS,
  mintClerkProdJwt,
} from './helpers/clerk-prod-auth';

const TENANTS = [
  {
    slug: 'ceremonia',
    url: process.env.MC_CEREMONIA_URL ?? 'https://mc-ceremonia.holalumina.com',
    tokenId: process.env.CF_ACCESS_CEREMONIA_TOKEN_ID,
    tokenSecret: process.env.CF_ACCESS_CEREMONIA_TOKEN_SECRET,
  },
  {
    slug: 'eric',
    url: process.env.MC_ERIC_URL ?? 'https://mc-eric.holalumina.com',
    tokenId: process.env.CF_ACCESS_ERIC_TOKEN_ID,
    tokenSecret: process.env.CF_ACCESS_ERIC_TOKEN_SECRET,
  },
  {
    slug: 'lumina',
    url: process.env.MC_LUMINA_URL ?? 'https://mc-lumina.holalumina.com',
    tokenId: process.env.CF_ACCESS_LUMINA_TOKEN_ID,
    tokenSecret: process.env.CF_ACCESS_LUMINA_TOKEN_SECRET,
  },
];

function authHeaders(tenant: typeof TENANTS[number]): Record<string, string> {
  if (!tenant.tokenId || !tenant.tokenSecret) {
    throw new Error(
      `CF Access service token missing for ${tenant.slug}. ` +
        `Set CF_ACCESS_${tenant.slug.toUpperCase()}_TOKEN_ID + _TOKEN_SECRET.`,
    );
  }
  return {
    'CF-Access-Client-Id': tenant.tokenId,
    'CF-Access-Client-Secret': tenant.tokenSecret,
  };
}

// CF Access path AUTO-SKIPPED post-cutover (apps deleted 2026-05-19).
// Tests in this block throw on undefined CF tokens; the new Clerk-era
// describe block below carries D10 forward.
test.describe.skip('Phase 1 cross-tenant isolation — CF Access (RETIRED post-cutover)', () => {
  test('unauthenticated request to mc-ceremonia is challenged', async () => {
    const ctx = await request.newContext({ extraHTTPHeaders: {} });
    const res = await ctx.get(`${TENANTS[0].url}/api/status`, { failOnStatusCode: false });
    // CF Access challenges: 302 → access.cloudflareaccess.com OR 401/403 if no Identity provider
    expect([302, 401, 403]).toContain(res.status());
  });

  for (const own of TENANTS) {
    test(`tenant ${own.slug} CAN reach own MC`, async () => {
      const ctx = await request.newContext({ extraHTTPHeaders: authHeaders(own) });
      const res = await ctx.get(`${own.url}/api/status`);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.healthy).toBe(true);
    });

    for (const other of TENANTS) {
      if (other.slug === own.slug) continue;
      test(`tenant ${own.slug} CANNOT reach mc-${other.slug} (cross-tenant deny)`, async () => {
        // OWN tenant's CF Access service token against OTHER tenant's URL
        const ctx = await request.newContext({ extraHTTPHeaders: authHeaders(own) });
        const res = await ctx.get(`${other.url}/api/status`, { failOnStatusCode: false });
        // Expected: CF Access denies because own.tokenId is not in other tenant's policy
        expect([401, 403]).toContain(res.status());
        // Defensive: ensure no MC content leaks via error page
        const body = await res.text();
        expect(body).not.toMatch(/agents|tasks|sessions/i);
      });
    }
  }

  // Bonus: data-layer isolation via /api/whoami (if MC fork exposes it)
  for (const tenant of TENANTS) {
    test(`tenant ${tenant.slug} /api/whoami returns own tenant_id`, async () => {
      const ctx = await request.newContext({ extraHTTPHeaders: authHeaders(tenant) });
      const res = await ctx.get(`${tenant.url}/api/whoami`, { failOnStatusCode: false });
      if (res.status() === 404) {
        test.skip(true, '/api/whoami not implemented yet — skipping data-layer isolation check');
        return;
      }
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.tenant_slug).toBe(tenant.slug);
    });
  }
});

/**
 * Exit gate semantics (CF Access — RETIRED):
 *   - 1 unauth + 3 own-reach + 6 cross-tenant-deny + 3 whoami = 13 tests
 *   - All auto-skipped post-cutover; semantics preserved by Clerk block below.
 */

// ---------------------------------------------------------------------------
// Clerk-era D10 — exit gate replacement
// ---------------------------------------------------------------------------

const CLERK_TENANTS: Array<{
  slug: 'ceremonia' | 'ericedmeades' | 'holalumina'
  host: string
}> = [
  { slug: 'ceremonia', host: TENANT_SUBDOMAINS.ceremonia },
  { slug: 'ericedmeades', host: TENANT_SUBDOMAINS.ericedmeades },
  { slug: 'holalumina', host: TENANT_SUBDOMAINS.holalumina },
]

test.describe('Phase 1 D10 cross-tenant isolation (Clerk era)', () => {
  test.skip(!process.env.CLERK_SECRET_KEY, 'CLERK_SECRET_KEY required for prod Clerk JWT')

  test('unauth → 307 to accounts.holalumina.com/sign-in (every MC)', async ({ request: req }) => {
    for (const t of CLERK_TENANTS) {
      const res = await req.get(`https://${t.host}/`, { maxRedirects: 0 })
      expect([302, 307]).toContain(res.status())
      const loc = res.headers()['location'] ?? ''
      expect(loc).toMatch(/^https:\/\/accounts\.holalumina\.com\/sign-in/)
    }
  })

  for (const own of CLERK_TENANTS) {
    test(`tenant ${own.slug} CAN reach own MC /api/auth/me with valid Bearer`, async ({ request: req }) => {
      const { jwt } = await mintClerkProdJwt({ orgSlug: own.slug, email: PROD_FIXTURE_EMAIL })
      const res = await req.get(`https://${own.host}/api/auth/me`, {
        headers: { Authorization: `Bearer ${jwt}`, Cookie: `__session=${jwt}` },
      })
      expect(res.status()).toBe(200)
    })

    for (const other of CLERK_TENANTS) {
      if (other.slug === own.slug) continue
      test(`tenant ${own.slug} CANNOT reach mc-${other.slug.slice(0, 4)} (Clerk org-claim mismatch → 403)`, async ({ request: req }) => {
        const { jwt } = await mintClerkProdJwt({ orgSlug: own.slug, email: PROD_FIXTURE_EMAIL })
        const res = await req.get(`https://${other.host}/api/auth/me`, {
          headers: { Authorization: `Bearer ${jwt}`, Cookie: `__session=${jwt}` },
        })
        expect(res.status(), `${own.slug} → ${other.slug} must be 403`).toBe(403)
        // Defensive content leak check
        const body = await res.text()
        expect(body).not.toMatch(/agents|tasks|sessions/i)
      })
    }
  }
})
