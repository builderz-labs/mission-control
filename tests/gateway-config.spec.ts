import { expect, test } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Gateway Config API', () => {
  test('GET /api/gateway-config returns config object and path', async ({ request }) => {
    const res = await request.get('/api/gateway-config', {
      headers: API_KEY_HEADER,
    })
    expect([200, 404]).toContain(res.status())

    const body = await res.json()
    if (res.status() === 200) {
      expect(body).toHaveProperty('path')
      expect(body).toHaveProperty('config')
      expect(body).toHaveProperty('raw_size')
      expect(typeof body.raw_size).toBe('number')
    } else {
      expect(body).toHaveProperty('error')
    }
  })

  test('GET /api/gateway-config returns hash for concurrency', async ({ request }) => {
    const res = await request.get('/api/gateway-config', {
      headers: API_KEY_HEADER,
    })
    expect([200, 404]).toContain(res.status())

    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('hash')
      expect(typeof body.hash).toBe('string')
      expect(body.hash.length).toBe(64) // sha256 hex
    }
  })

  test('GET /api/gateway-config?action=schema returns schema or graceful error', async ({ request }) => {
    const res = await request.get('/api/gateway-config?action=schema', {
      headers: API_KEY_HEADER,
    })
    // Gateway may not be running, so 502 is expected
    expect([200, 502]).toContain(res.status())

    const body = await res.json()
    if (res.status() === 200) {
      expect(typeof body).toBe('object')
    } else {
      expect(body).toHaveProperty('error')
    }
  })

  test('PUT /api/gateway-config rejects without auth', async ({ request }) => {
    const res = await request.put('/api/gateway-config', {
      headers: { 'Content-Type': 'application/json' },
      data: { updates: { 'test.key': 'value' } },
    })
    expect(res.status()).toBe(401)
  })

  test('PUT /api/gateway-config with stale hash returns 409', async ({ request }) => {
    // First check if config is accessible
    const getRes = await request.get('/api/gateway-config', {
      headers: API_KEY_HEADER,
    })

    if (getRes.status() !== 200) {
      test.skip(true, 'Config file not available')
      return
    }

    const res = await request.put('/api/gateway-config', {
      headers: API_KEY_HEADER,
      data: {
        updates: { 'logging.redactSensitive': 'all' },
        hash: 'stale-hash-that-does-not-match',
      },
    })
    expect(res.status()).toBe(409)
    const body = await res.json()
    expect(body).toHaveProperty('error')
    expect(body.error).toContain('modified')
  })
})
