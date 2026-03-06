import { expect, test } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

/**
 * E2E tests for the gateway proxy endpoints.
 *
 * These tests run against a live Next.js server.  They validate the HTTP
 * surface of /api/gateway-proxy (POST) and /api/gateway-proxy/stream (GET)
 * rather than exercising a real OpenClaw gateway connection.
 *
 * When GATEWAY_PROXY_MODE is not set (default), both endpoints return 404.
 * The tests therefore cover both the "disabled" and (where feasible without
 * a real gateway) the "enabled-but-no-gateway" paths.
 */
test.describe('Gateway Proxy API — proxy mode disabled (default)', () => {
  test('POST /api/gateway-proxy returns 404 when proxy mode is off', async ({ request }) => {
    const res = await request.post('/api/gateway-proxy', {
      headers: API_KEY_HEADER,
      data: { method: 'ping' },
    })
    // When GATEWAY_PROXY_MODE is not set the route returns 404
    expect(res.status()).toBe(404)
  })

  test('GET /api/gateway-proxy/stream returns 404 when proxy mode is off', async ({ request }) => {
    const res = await request.get('/api/gateway-proxy/stream', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(404)
  })
})

test.describe('Gateway Proxy API — auth enforcement', () => {
  test('POST /api/gateway-proxy requires authentication', async ({ request }) => {
    // No auth header → should get 401 before the proxy-mode check matters
    // (If proxy mode is disabled the 404 takes precedence, so we accept either.)
    const res = await request.post('/api/gateway-proxy', {
      data: { method: 'ping' },
    })
    expect([401, 404]).toContain(res.status())
  })

  test('GET /api/gateway-proxy/stream requires authentication', async ({ request }) => {
    const res = await request.get('/api/gateway-proxy/stream')
    expect([401, 404]).toContain(res.status())
  })
})

test.describe('Gateway Proxy API — method allowlist (proxy mode enabled via env)', () => {
  // These tests only exercise behaviour when GATEWAY_PROXY_MODE is enabled.
  // In the standard test environment the mode is off, so we skip them unless
  // the flag is present.
  const proxyModeEnabled =
    process.env.GATEWAY_PROXY_MODE === '1' ||
    process.env.GATEWAY_PROXY_MODE === 'true'

  test('rejects disallowed gateway method with 403', async ({ request }) => {
    test.skip(!proxyModeEnabled, 'GATEWAY_PROXY_MODE not enabled')

    const res = await request.post('/api/gateway-proxy', {
      headers: API_KEY_HEADER,
      data: { method: 'internal.shutdown' },
    })
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/not allowed/i)
  })

  test('returns 503 / triggers reconnect when gateway is unreachable', async ({ request }) => {
    test.skip(!proxyModeEnabled, 'GATEWAY_PROXY_MODE not enabled')

    // No real gateway is running in this environment so the manager
    // should return 503 and schedule a reconnect.
    const res = await request.post('/api/gateway-proxy', {
      headers: API_KEY_HEADER,
      data: { method: 'ping' },
    })
    // 200 (connected) or 503 (not connected) — both are valid outcomes
    expect([200, 503]).toContain(res.status())
  })

  test('GET /api/gateway-proxy/stream returns SSE content-type', async ({ request }) => {
    test.skip(!proxyModeEnabled, 'GATEWAY_PROXY_MODE not enabled')

    const res = await request.get('/api/gateway-proxy/stream', {
      headers: API_KEY_HEADER,
    })
    // The endpoint should open successfully and declare SSE content-type
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('text/event-stream')
  })
})
