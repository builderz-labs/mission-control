import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Session Control API', () => {

  // ── GET /api/sessions ──────────────────────────

  test('GET /sessions returns sessions array', async ({ request }) => {
    const res = await request.get('/api/sessions', { headers: API_KEY_HEADER })

    // May return 200 with sessions or empty array (depending on server state)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('sessions')
    expect(Array.isArray(body.sessions)).toBe(true)
  })

  test('GET /sessions returns 401 without auth', async ({ request }) => {
    const res = await request.get('/api/sessions')
    expect(res.status()).toBe(401)
  })

  // ── POST /api/sessions/[id]/control ────────────

  test('POST /sessions/:id/control rejects invalid session ID format', async ({ request }) => {
    // Use dots (not in /^[a-zA-Z0-9_-]+$/) — avoids URL fragment (#) truncation issues
    const res = await request.post('/api/sessions/invalid..session..id/control', {
      headers: API_KEY_HEADER,
      data: { action: 'pause' },
    })

    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid session ID')
  })

  test('POST /sessions/:id/control rejects invalid action', async ({ request }) => {
    const res = await request.post('/api/sessions/test-session-001/control', {
      headers: API_KEY_HEADER,
      data: { action: 'destroy' },
    })

    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid action')
  })

  test('POST /sessions/:id/control accepts monitor action', async ({ request }) => {
    const res = await request.post('/api/sessions/test-session-001/control', {
      headers: API_KEY_HEADER,
      data: { action: 'monitor' },
    })

    // Will be 200 (success) or 500 (no clawdbot running) — but NOT 400
    expect([200, 500]).toContain(res.status())
  })

  test('POST /sessions/:id/control accepts pause action', async ({ request }) => {
    const res = await request.post('/api/sessions/test-session-002/control', {
      headers: API_KEY_HEADER,
      data: { action: 'pause' },
    })

    expect([200, 500]).toContain(res.status())
  })

  test('POST /sessions/:id/control accepts terminate action', async ({ request }) => {
    const res = await request.post('/api/sessions/test-session-003/control', {
      headers: API_KEY_HEADER,
      data: { action: 'terminate' },
    })

    expect([200, 500]).toContain(res.status())
  })

  test('POST /sessions/:id/control returns 401 without auth', async ({ request }) => {
    const res = await request.post('/api/sessions/test-session/control', {
      data: { action: 'pause' },
    })

    expect(res.status()).toBe(401)
  })

  // ── GET /api/sessions/[id]/debrief ─────────────

  test('GET /sessions/:id/debrief returns 404 for non-existent session', async ({ request }) => {
    const res = await request.get('/api/sessions/nonexistent-session-999/debrief', {
      headers: API_KEY_HEADER,
    })

    // generateMissionDebrief returns null for unknown sessions
    expect([404, 500]).toContain(res.status())
  })

  test('GET /sessions/:id/debrief returns 401 without auth', async ({ request }) => {
    const res = await request.get('/api/sessions/some-session/debrief')
    expect(res.status()).toBe(401)
  })

  // ── POST /api/sessions/[id]/intervene ──────────

  test('POST /sessions/:id/intervene rejects invalid action', async ({ request }) => {
    const res = await request.post('/api/sessions/test-session/intervene', {
      headers: API_KEY_HEADER,
      data: { action: 'INVALID_ACTION' },
    })

    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid action')
  })

  test('POST /sessions/:id/intervene returns 404 for non-existent session', async ({ request }) => {
    const res = await request.post('/api/sessions/nonexistent-session-999/intervene', {
      headers: API_KEY_HEADER,
      data: { action: 'RESCAN' },
    })

    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('not found')
  })

  test('POST /sessions/:id/intervene returns 401 without auth', async ({ request }) => {
    const res = await request.post('/api/sessions/test-session/intervene', {
      data: { action: 'ROLLBACK' },
    })

    expect(res.status()).toBe(401)
  })

  // ── GET /api/sessions/[id]/remediation ─────────

  test('GET /sessions/:id/remediation returns 404 for non-existent session', async ({ request }) => {
    const res = await request.get('/api/sessions/nonexistent-session-999/remediation', {
      headers: API_KEY_HEADER,
    })

    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('not found')
  })

  test('GET /sessions/:id/remediation returns 401 without auth', async ({ request }) => {
    const res = await request.get('/api/sessions/some-session/remediation')
    expect(res.status()).toBe(401)
  })
})
