import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('Standup & Heartbeat', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestAgent(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  // ── POST /api/standup ────────────────────────

  test('POST /api/standup generates a standup report', async ({ request }) => {
    const today = new Date().toISOString().slice(0, 10)

    const res = await request.post('/api/standup', {
      headers: API_KEY_HEADER,
      data: { date: today },
    })
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body.standup).toBeDefined()
    expect(body.standup.date).toBe(today)
    expect(body.standup.generatedAt).toBeDefined()
    expect(body.standup.summary).toBeDefined()
    expect(body.standup.summary).toHaveProperty('totalAgents')
    expect(body.standup.summary).toHaveProperty('totalCompleted')
    expect(body.standup.summary).toHaveProperty('totalInProgress')
    expect(Array.isArray(body.standup.agentReports)).toBe(true)
  })

  test('POST /api/standup accepts specific agents filter', async ({ request }) => {
    const { id, name } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.post('/api/standup', {
      headers: API_KEY_HEADER,
      data: { agents: [name] },
    })
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body.standup).toBeDefined()
    expect(Array.isArray(body.standup.agentReports)).toBe(true)
    expect(body.standup.agentReports.length).toBe(1)
    expect(body.standup.agentReports[0].agent.name).toBe(name)
  })

  // ── GET /api/standup ─────────────────────────

  test('GET /api/standup returns standup history', async ({ request }) => {
    const res = await request.get('/api/standup', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(Array.isArray(body.history)).toBe(true)
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('page')
    expect(body).toHaveProperty('limit')
  })

  // ── GET /api/agents/[id]/heartbeat ───────────

  test('GET heartbeat returns HEARTBEAT_OK for agent with no work', async ({ request }) => {
    const { id, name } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.get(`/api/agents/${name}/heartbeat`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body.status).toBe('HEARTBEAT_OK')
    expect(body.agent).toBe(name)
    expect(body.checked_at).toBeDefined()
  })

  test('GET heartbeat returns 404 for unknown agent', async ({ request }) => {
    const res = await request.get('/api/agents/nonexistent-agent-xyz-999/heartbeat', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(404)
  })

  // ── POST /api/agents/[id]/heartbeat ──────────

  test('POST heartbeat returns response with token_recorded', async ({ request }) => {
    const { id, name } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.post(`/api/agents/${name}/heartbeat`, {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('token_recorded')
    expect(body.token_recorded).toBe(false)
    expect(body.agent).toBe(name)
  })

  test('POST heartbeat records token usage', async ({ request }) => {
    const { id, name } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.post(`/api/agents/${name}/heartbeat`, {
      headers: API_KEY_HEADER,
      data: {
        token_usage: {
          model: 'test-model',
          inputTokens: 100,
          outputTokens: 50,
        },
      },
    })
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body.token_recorded).toBe(true)
    expect(body.agent).toBe(name)
  })
})
