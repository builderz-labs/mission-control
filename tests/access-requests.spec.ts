import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Access Requests', () => {
  // ── GET /api/auth/access-requests ─────────────

  test('GET access-requests returns list of requests', async ({ request }) => {
    const res = await request.get('/api/auth/access-requests', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('requests')
    expect(Array.isArray(body.requests)).toBe(true)
  })

  test('GET access-requests supports status=pending filter', async ({ request }) => {
    const res = await request.get('/api/auth/access-requests?status=pending', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.requests)).toBe(true)
    // All returned should be pending
    for (const req of body.requests) {
      expect(req.status).toBe('pending')
    }
  })

  test('GET access-requests supports status=approved filter', async ({ request }) => {
    const res = await request.get('/api/auth/access-requests?status=approved', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.requests)).toBe(true)
    for (const req of body.requests) {
      expect(req.status).toBe('approved')
    }
  })

  test('GET access-requests supports status=rejected filter', async ({ request }) => {
    const res = await request.get('/api/auth/access-requests?status=rejected', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.requests)).toBe(true)
    for (const req of body.requests) {
      expect(req.status).toBe('rejected')
    }
  })

  // ── POST /api/auth/access-requests (reject action) ──

  test('POST access-requests reject returns 404 for nonexistent request', async ({ request }) => {
    const res = await request.post('/api/auth/access-requests', {
      headers: API_KEY_HEADER,
      data: {
        request_id: 999999,
        action: 'reject',
        note: 'E2E test rejection',
      },
    })
    expect(res.status()).toBe(404)
  })

  // ── POST /api/auth/access-requests (approve action) ──

  test('POST access-requests approve returns 404 for nonexistent request', async ({ request }) => {
    const res = await request.post('/api/auth/access-requests', {
      headers: API_KEY_HEADER,
      data: {
        request_id: 999999,
        action: 'approve',
        role: 'viewer',
      },
    })
    expect(res.status()).toBe(404)
  })

  // ── POST validation ──────────────────────────

  test('POST access-requests rejects invalid action', async ({ request }) => {
    const res = await request.post('/api/auth/access-requests', {
      headers: API_KEY_HEADER,
      data: {
        request_id: 1,
        action: 'delete',
      },
    })
    expect(res.status()).toBe(400)
  })

  test('POST access-requests rejects missing request_id', async ({ request }) => {
    const res = await request.post('/api/auth/access-requests', {
      headers: API_KEY_HEADER,
      data: {
        action: 'approve',
        role: 'viewer',
      },
    })
    expect(res.status()).toBe(400)
  })
})
