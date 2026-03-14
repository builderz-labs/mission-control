/**
 * Docker-mode integration tests
 *
 * Covers the three regressions fixed before this test was added:
 *   1. 404 on gateway health check  — onboarding wizard was using GET
 *      but the endpoint only exposes POST (#334)
 *   2. EROFS / busy-init write errors — db.ts eager init at build time
 *      caused "read-only filesystem" failures in Docker (#337)
 *   3. Missing OPENCLAW_HOME env — gateway-config path resolution relied
 *      on env vars that may not be set in a minimal Docker environment
 *
 * All tests run against the live server and require no Docker daemon.
 * They validate the API contract that the Docker runtime depends on.
 */

import { expect, test } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

// ─── 1. Gateway health endpoint accepts POST, not GET ────────────────────────

test.describe('Docker mode – gateway health check endpoint contract', () => {
  test('POST /api/gateways/health returns 200 with results array', async ({ request }) => {
    const res = await request.post('/api/gateways/health', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.results)).toBe(true)
    expect(typeof body.probed_at).toBe('number')
  })

  test('GET /api/gateways/health returns 405 (method not allowed)', async ({ request }) => {
    const res = await request.get('/api/gateways/health', {
      headers: API_KEY_HEADER,
    })
    // Next.js returns 405 for unregistered methods on route handlers
    expect(res.status()).toBe(405)
  })

  test('POST /api/gateways/health requires auth', async ({ request }) => {
    const res = await request.post('/api/gateways/health')
    expect(res.status()).toBe(401)
  })
})

// ─── 2. Database init does not blow up on first request (EROFS guard) ────────
//
// In Docker the build phase happens with a read-only overlay FS.
// The fix guards module-level getDatabase() behind !isBuildPhase so the
// first runtime request triggers lazy init, not the build step.
// We verify this by making requests that exercise DB paths.

test.describe('Docker mode – lazy DB init on first request', () => {
  test('GET /api/onboarding succeeds (verifies DB accessible at runtime)', async ({ request }) => {
    const res = await request.get('/api/onboarding', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('steps')
  })

  test('POST /api/gateways returns 201 (verifies DB write works at runtime)', async ({ request }) => {
    const name = `docker-mode-test-gw-${Date.now()}`
    const res = await request.post('/api/gateways', {
      headers: API_KEY_HEADER,
      data: {
        name,
        host: 'http://gateway.internal:4443',
        port: 18789,
        token: 'docker-mode-token',
      },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    const id = body.gateway?.id as number

    // Cleanup
    await request.delete('/api/gateways', {
      headers: API_KEY_HEADER,
      data: { id },
    })
  })
})

// ─── 3. Gateway connect resolves without OPENCLAW_HOME in environment ────────
//
// The connect endpoint resolves ws_url from the stored gateway record,
// not from env vars. It must work when OPENCLAW_HOME / OPENCLAW_STATE_DIR
// are absent (plain Docker with no mounted .openclaw volume).

test.describe('Docker mode – gateway connect works without home env vars', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup.splice(0)) {
      await request.delete('/api/gateways', {
        headers: API_KEY_HEADER,
        data: { id },
      }).catch(() => {})
    }
  })

  test('POST /api/gateways/connect returns ws_url derived from stored host (no env dependency)', async ({ request }) => {
    // Register a gateway that would only be reachable inside Docker
    const createRes = await request.post('/api/gateways', {
      headers: API_KEY_HEADER,
      data: {
        name: `docker-mode-connect-${Date.now()}`,
        host: 'https://openclaw-gateway:4443/sessions',
        port: 18789,
        token: 'docker-internal-token',
      },
    })
    expect(createRes.status()).toBe(201)
    const createBody = await createRes.json()
    const gatewayId = createBody.gateway?.id as number
    cleanup.push(gatewayId)

    const connectRes = await request.post('/api/gateways/connect', {
      headers: API_KEY_HEADER,
      data: { id: gatewayId },
    })
    expect(connectRes.status()).toBe(200)
    const connectBody = await connectRes.json()

    // ws_url is derived purely from stored host — no env vars needed
    expect(connectBody.ws_url).toBe('wss://openclaw-gateway:4443')
    expect(connectBody.token).toBe('docker-internal-token')
    expect(connectBody.token_set).toBe(true)
  })

  test('POST /api/gateways/connect returns 404 for unknown id (no crash on missing env)', async ({ request }) => {
    const res = await request.post('/api/gateways/connect', {
      headers: API_KEY_HEADER,
      data: { id: 999999 },
    })
    expect(res.status()).toBe(404)
  })
})

// ─── 4. Onboarding gateway-link step marks correctly ─────────────────────────
//
// The wizard's gateway-link step previously checked health via a broken GET.
// Verify the full onboarding lifecycle works, including the gateway step.

test.describe('Docker mode – onboarding gateway-link step', () => {
  test.beforeEach(async ({ request }) => {
    await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'reset' },
    })
  })

  test('gateway-link step can be completed via POST /api/onboarding', async ({ request }) => {
    const res = await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'complete_step', step: 'gateway-link' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.completedSteps).toContain('gateway-link')
  })

  test('onboarding state still shows showOnboarding=false after all steps done', async ({ request }) => {
    const steps = ['welcome', 'interface-mode', 'gateway-link', 'credentials']
    for (const step of steps) {
      await request.post('/api/onboarding', {
        headers: API_KEY_HEADER,
        data: { action: 'complete_step', step },
      })
    }
    await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'complete' },
    })

    const res = await request.get('/api/onboarding', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.showOnboarding).toBe(false)
    expect(body.completed).toBe(true)
  })
})
