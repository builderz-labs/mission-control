import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Integrations API', () => {
  // ── GET /api/integrations ─────────────────────────

  test('GET returns integrations list with categories', async ({ request }) => {
    const res = await request.get('/api/integrations', {
      headers: API_KEY_HEADER,
    })
    // 200 if OPENCLAW_STATE_DIR is set, 404 otherwise
    const status = res.status()
    if (status === 404) {
      const body = await res.json()
      expect(body.error).toContain('OPENCLAW_STATE_DIR')
      return
    }
    expect(status).toBe(200)
    const body = await res.json()
    expect(body.integrations).toBeDefined()
    expect(Array.isArray(body.integrations)).toBe(true)
    expect(body.categories).toBeDefined()
    expect(Array.isArray(body.categories)).toBe(true)
    expect(typeof body.opAvailable).toBe('boolean')

    // Each integration should have the required shape
    if (body.integrations.length > 0) {
      const first = body.integrations[0]
      expect(first).toHaveProperty('id')
      expect(first).toHaveProperty('name')
      expect(first).toHaveProperty('category')
      expect(first).toHaveProperty('categoryLabel')
      expect(first).toHaveProperty('envVars')
      expect(first).toHaveProperty('status')
      expect(first).toHaveProperty('testable')
      expect(['connected', 'partial', 'not_configured']).toContain(first.status)
    }
  })

  test('GET rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/integrations')
    expect(res.status()).toBe(401)
  })

  // ── POST /api/integrations (action dispatcher) ────

  test('POST test action rejects unknown integration', async ({ request }) => {
    const res = await request.post('/api/integrations', {
      headers: API_KEY_HEADER,
      data: { action: 'test', integrationId: 'nonexistent-integration-xyz' },
    })
    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('Unknown integration')
  })

  test('POST test action rejects non-testable integration', async ({ request }) => {
    // nvidia is not testable
    const res = await request.post('/api/integrations', {
      headers: API_KEY_HEADER,
      data: { action: 'test', integrationId: 'nvidia' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('does not support testing')
  })

  test('POST rejects missing integrationId for test action', async ({ request }) => {
    const res = await request.post('/api/integrations', {
      headers: API_KEY_HEADER,
      data: { action: 'test' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('integrationId required')
  })

  test('POST rejects invalid action', async ({ request }) => {
    const res = await request.post('/api/integrations', {
      headers: API_KEY_HEADER,
      data: { action: 'invalid-action', integrationId: 'anthropic' },
    })
    // Zod validation should reject the enum
    expect(res.status()).toBe(400)
  })

  // ── PUT /api/integrations (update env vars) ───────

  test('PUT rejects missing vars object', async ({ request }) => {
    const res = await request.put('/api/integrations', {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('vars object required')
  })

  test('PUT rejects protected variables like PATH', async ({ request }) => {
    const res = await request.put('/api/integrations', {
      headers: API_KEY_HEADER,
      data: { vars: { PATH: '/usr/bin' } },
    })
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('protected variable')
  })

  test('PUT rejects invalid variable names', async ({ request }) => {
    const res = await request.put('/api/integrations', {
      headers: API_KEY_HEADER,
      data: { vars: { '123-bad-name!': 'value' } },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid variable name')
  })

  // ── DELETE /api/integrations ──────────────────────

  test('DELETE rejects missing keys parameter', async ({ request }) => {
    const res = await request.delete('/api/integrations', {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('keys parameter required')
  })

  test('DELETE rejects protected variables', async ({ request }) => {
    const res = await request.delete('/api/integrations', {
      headers: API_KEY_HEADER,
      data: { keys: 'PATH' },
    })
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('protected variable')
  })
})
