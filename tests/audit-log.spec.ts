import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Audit Log', () => {
  // ── GET /api/audit ─────────────────────────────

  test('GET returns audit events list shape', async ({ request }) => {
    const res = await request.get('/api/audit', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('events')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('limit')
    expect(body).toHaveProperty('offset')
    expect(Array.isArray(body.events)).toBe(true)
    expect(typeof body.total).toBe('number')
    expect(typeof body.limit).toBe('number')
    expect(typeof body.offset).toBe('number')
  })

  test('GET respects limit and offset params', async ({ request }) => {
    const res = await request.get('/api/audit?limit=2&offset=0', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.events.length).toBeLessThanOrEqual(2)
    expect(body.limit).toBe(2)
    expect(body.offset).toBe(0)
  })

  test('GET filters by action', async ({ request }) => {
    const res = await request.get('/api/audit?action=task.created', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.events)).toBe(true)
    for (const event of body.events) {
      expect(event.action).toBe('task.created')
    }
  })

  test('GET filters by actor', async ({ request }) => {
    const res = await request.get('/api/audit?actor=API%20Access', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.events)).toBe(true)
    for (const event of body.events) {
      expect(event.actor).toBe('API Access')
    }
  })

  test('GET rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/audit')
    expect(res.status()).toBe(401)
  })
})
