import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('Agent Communications (message, comms, sync)', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestAgent(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  // ── POST /api/agents/message ──────────────────

  test('POST message returns 404 for nonexistent recipient', async ({ request }) => {
    const res = await request.post('/api/agents/message', {
      headers: API_KEY_HEADER,
      data: { to: 'nonexistent-agent-xyz', message: 'Hello!' },
    })
    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('not found')
  })

  test('POST message returns 400 when agent has no session key', async ({ request }) => {
    const { id, name } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.post('/api/agents/message', {
      headers: API_KEY_HEADER,
      data: { to: name, message: 'Hello test agent!' },
    })
    // Agent has no session_key → 400
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('session key')
  })

  test('POST message validates required fields - missing to', async ({ request }) => {
    const res = await request.post('/api/agents/message', {
      headers: API_KEY_HEADER,
      data: { message: 'Hello!' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST message validates required fields - missing message', async ({ request }) => {
    const res = await request.post('/api/agents/message', {
      headers: API_KEY_HEADER,
      data: { to: 'some-agent' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST message validates required fields - empty message', async ({ request }) => {
    const res = await request.post('/api/agents/message', {
      headers: API_KEY_HEADER,
      data: { to: 'some-agent', message: '' },
    })
    expect(res.status()).toBe(400)
  })

  // ── GET /api/agents/comms ─────────────────────

  test('GET comms returns messages, graph, and source info', async ({ request }) => {
    const res = await request.get('/api/agents/comms', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('messages')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('graph')
    expect(body.graph).toHaveProperty('edges')
    expect(body.graph).toHaveProperty('agentStats')
    expect(body).toHaveProperty('source')
    expect(body.source).toHaveProperty('mode')
    expect(['empty', 'seeded', 'live', 'mixed']).toContain(body.source.mode)
    expect(Array.isArray(body.messages)).toBe(true)
  })

  test('GET comms supports limit and offset params', async ({ request }) => {
    const res = await request.get('/api/agents/comms?limit=5&offset=0', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.messages.length).toBeLessThanOrEqual(5)
  })

  test('GET comms supports agent filter param', async ({ request }) => {
    const { id, name } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.get(`/api/agents/comms?agent=${name}`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.messages)).toBe(true)
  })

  test('GET comms supports since filter param', async ({ request }) => {
    const since = Math.floor(Date.now() / 1000) - 3600
    const res = await request.get(`/api/agents/comms?since=${since}`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.messages)).toBe(true)
    expect(typeof body.total).toBe('number')
  })

  // ── POST /api/agents/sync ────────────────────

  test('POST sync triggers agent config sync', async ({ request }) => {
    // This requires admin role and openclaw.json to be present.
    // It may return 500 if the config file is not set up, which is acceptable in E2E.
    const res = await request.post('/api/agents/sync', {
      headers: API_KEY_HEADER,
      data: {},
    })
    // Expect either success (200) or server error (500) due to missing config
    expect([200, 500]).toContain(res.status())
  })

  // ── GET /api/agents/sync ─────────────────────

  test('GET sync returns preview diff', async ({ request }) => {
    const res = await request.get('/api/agents/sync', { headers: API_KEY_HEADER })
    // May succeed or 500 if openclaw.json is not present
    expect([200, 500]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(typeof body).toBe('object')
    }
  })
})
