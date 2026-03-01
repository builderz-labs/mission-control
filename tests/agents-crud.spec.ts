import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('Agents CRUD', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestAgent(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  // ── POST /api/agents ─────────────────────────

  test('POST creates agent with name and role', async ({ request }) => {
    const { id, res, body } = await createTestAgent(request)
    cleanup.push(id)

    expect(res.status()).toBe(201)
    expect(body.agent).toBeDefined()
    expect(body.agent.name).toContain('e2e-agent-')
    expect(body.agent.role).toBe('tester')
    expect(body.agent.status).toBe('offline')
  })

  test('POST rejects missing name', async ({ request }) => {
    const res = await request.post('/api/agents', {
      headers: API_KEY_HEADER,
      data: { role: 'tester' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST rejects duplicate name', async ({ request }) => {
    const { id, body: first } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.post('/api/agents', {
      headers: API_KEY_HEADER,
      data: { name: first.agent.name, role: 'duplicate' },
    })
    expect(res.status()).toBe(409)
  })

  // ── GET /api/agents ──────────────────────────

  test('GET list returns agents with pagination and taskStats', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.get('/api/agents', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('agents')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('page')
    expect(body).toHaveProperty('limit')
    expect(Array.isArray(body.agents)).toBe(true)

    // Every agent should have taskStats
    for (const a of body.agents) {
      expect(a.taskStats).toBeDefined()
      expect(a.taskStats).toHaveProperty('total')
    }
  })

  // ── GET /api/agents/[id] ─────────────────────

  test('GET single by numeric id', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.get(`/api/agents/${id}`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.agent.id).toBe(id)
  })

  test('GET single by name', async ({ request }) => {
    const { id, name } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.get(`/api/agents/${name}`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.agent.name).toBe(name)
  })

  test('GET single returns 404 for missing', async ({ request }) => {
    const res = await request.get('/api/agents/999999', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })

  // ── PUT /api/agents/[id] ─────────────────────

  test('PUT by id updates role', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.put(`/api/agents/${id}`, {
      headers: API_KEY_HEADER,
      data: { role: 'reviewer' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.agent.role).toBe('reviewer')
  })

  test('PUT by id returns 404 for missing', async ({ request }) => {
    const res = await request.put('/api/agents/999999', {
      headers: API_KEY_HEADER,
      data: { role: 'reviewer' },
    })
    expect(res.status()).toBe(404)
  })

  // ── PUT /api/agents (bulk by name) ───────────

  test('PUT by name updates status', async ({ request }) => {
    const { id, name } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.put('/api/agents', {
      headers: API_KEY_HEADER,
      data: { name, status: 'online' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  test('PUT by name returns 404 for missing', async ({ request }) => {
    const res = await request.put('/api/agents', {
      headers: API_KEY_HEADER,
      data: { name: 'nonexistent-agent-xyz', status: 'online' },
    })
    expect(res.status()).toBe(404)
  })

  test('PUT by name returns 400 when no fields provided', async ({ request }) => {
    const { id, name } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.put('/api/agents', {
      headers: API_KEY_HEADER,
      data: { name },
    })
    expect(res.status()).toBe(400)
  })

  // ── DELETE /api/agents/[id] ──────────────────

  test('DELETE removes agent (admin via API key)', async ({ request }) => {
    const { id, name } = await createTestAgent(request)

    const res = await request.delete(`/api/agents/${id}`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.deleted).toBe(name)
  })

  test('DELETE returns 404 for missing agent', async ({ request }) => {
    const res = await request.delete('/api/agents/999999', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })

  // ── Full lifecycle ───────────────────────────

  test('full lifecycle: create → read → update → delete', async ({ request }) => {
    // Create
    const { id, name, res: createRes } = await createTestAgent(request, { role: 'builder' })
    expect(createRes.status()).toBe(201)

    // Read
    const readRes = await request.get(`/api/agents/${id}`, { headers: API_KEY_HEADER })
    expect(readRes.status()).toBe(200)
    const readBody = await readRes.json()
    expect(readBody.agent.role).toBe('builder')

    // Update via [id]
    const updateRes = await request.put(`/api/agents/${id}`, {
      headers: API_KEY_HEADER,
      data: { role: 'architect' },
    })
    expect(updateRes.status()).toBe(200)

    // Delete
    const deleteRes = await request.delete(`/api/agents/${id}`, { headers: API_KEY_HEADER })
    expect(deleteRes.status()).toBe(200)

    // Confirm gone
    const goneRes = await request.get(`/api/agents/${name}`, { headers: API_KEY_HEADER })
    expect(goneRes.status()).toBe(404)
  })
})
