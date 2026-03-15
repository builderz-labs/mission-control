import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Claude Sessions API', () => {
  // ── GET /api/claude/sessions ──────────────────────

  test('GET returns sessions list with stats and pagination', async ({ request }) => {
    const res = await request.get('/api/claude/sessions', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('sessions')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('stats')
    expect(Array.isArray(body.sessions)).toBe(true)
    expect(typeof body.total).toBe('number')

    // Stats should have the expected shape
    expect(body.stats).toHaveProperty('total_sessions')
    expect(body.stats).toHaveProperty('active_sessions')
    expect(body.stats).toHaveProperty('total_input_tokens')
    expect(body.stats).toHaveProperty('total_output_tokens')
    expect(body.stats).toHaveProperty('total_estimated_cost')
    expect(body.stats).toHaveProperty('total_loc_delta')
    expect(body.stats).toHaveProperty('unique_projects')
  })

  test('GET supports limit and offset query params', async ({ request }) => {
    const res = await request.get('/api/claude/sessions?limit=5&offset=0', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.sessions.length).toBeLessThanOrEqual(5)
  })

  test('GET supports active filter', async ({ request }) => {
    const res = await request.get('/api/claude/sessions?active=1', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.sessions)).toBe(true)
  })

  test('GET rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/claude/sessions')
    expect(res.status()).toBe(401)
  })

  // ── POST /api/claude/sessions ─────────────────────

  test('POST triggers manual scan and returns result', async ({ request }) => {
    const res = await request.post('/api/claude/sessions', {
      headers: API_KEY_HEADER,
      data: {},
    })
    // Should succeed or return 500 if scan fails (e.g. no Claude sessions dir)
    const status = res.status()
    expect([200, 500]).toContain(status)
    const body = await res.json()
    if (status === 200) {
      // Result from syncClaudeSessions — shape varies but should be an object
      expect(typeof body).toBe('object')
    } else {
      expect(body.error).toBeDefined()
    }
  })
})
