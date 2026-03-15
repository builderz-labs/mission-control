import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('Spatial API', () => {
  let agentA: { id: number; name: string }
  let agentB: { id: number; name: string }
  let agentC: { id: number; name: string }

  test.beforeAll(async ({ request }) => {
    const a = await createTestAgent(request, { role: 'orchestrator' })
    const b = await createTestAgent(request, { role: 'worker' })
    const c = await createTestAgent(request, { role: 'worker' })
    agentA = { id: a.id, name: a.name }
    agentB = { id: b.id, name: b.name }
    agentC = { id: c.id, name: c.name }
  })

  test.afterAll(async ({ request }) => {
    await deleteTestAgent(request, agentA.id)
    await deleteTestAgent(request, agentB.id)
    await deleteTestAgent(request, agentC.id)
  })

  // ── Relationships ──

  let relId1: number
  let relId2: number

  test('POST /api/spatial/relationships creates delegation edge', async ({ request }) => {
    const res = await request.post('/api/spatial/relationships', {
      headers: API_KEY_HEADER,
      data: {
        source_agent_id: agentA.id,
        target_agent_id: agentB.id,
        type: 'delegation',
      },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.relationship).toBeDefined()
    expect(body.relationship.type).toBe('delegation')
    relId1 = body.relationship.id
  })

  test('POST /api/spatial/relationships creates communication edge', async ({ request }) => {
    const res = await request.post('/api/spatial/relationships', {
      headers: API_KEY_HEADER,
      data: {
        source_agent_id: agentA.id,
        target_agent_id: agentC.id,
        type: 'communication',
      },
    })
    expect(res.status()).toBe(201)
    relId2 = (await res.json()).relationship.id
  })

  test('POST /api/spatial/relationships rejects invalid type', async ({ request }) => {
    const res = await request.post('/api/spatial/relationships', {
      headers: API_KEY_HEADER,
      data: {
        source_agent_id: agentA.id,
        target_agent_id: agentB.id,
        type: 'friendship',
      },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/spatial/relationships rejects self-relationship', async ({ request }) => {
    const res = await request.post('/api/spatial/relationships', {
      headers: API_KEY_HEADER,
      data: {
        source_agent_id: agentA.id,
        target_agent_id: agentA.id,
        type: 'delegation',
      },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/spatial/relationships rejects duplicate', async ({ request }) => {
    const res = await request.post('/api/spatial/relationships', {
      headers: API_KEY_HEADER,
      data: {
        source_agent_id: agentA.id,
        target_agent_id: agentB.id,
        type: 'delegation',
      },
    })
    expect(res.status()).toBe(409)
  })

  test('GET /api/spatial/relationships returns all', async ({ request }) => {
    const res = await request.get('/api/spatial/relationships', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.relationships.length).toBeGreaterThanOrEqual(2)
  })

  test('GET /api/spatial/relationships filters by agent_id', async ({ request }) => {
    const res = await request.get(`/api/spatial/relationships?agent_id=${agentC.id}`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.relationships.length).toBeGreaterThanOrEqual(1)
    for (const rel of body.relationships) {
      expect(
        rel.source_agent_id === agentC.id || rel.target_agent_id === agentC.id
      ).toBe(true)
    }
  })

  test('GET /api/spatial/relationships filters by type', async ({ request }) => {
    const res = await request.get('/api/spatial/relationships?type=delegation', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    for (const rel of body.relationships) {
      expect(rel.type).toBe('delegation')
    }
  })

  test('DELETE /api/spatial/relationships/:id removes relationship', async ({ request }) => {
    const res = await request.delete(`/api/spatial/relationships/${relId2}`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  test('DELETE /api/spatial/relationships/:id returns 404 for missing', async ({ request }) => {
    const res = await request.delete('/api/spatial/relationships/999999', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(404)
  })

  // ── Positions ──

  test('PUT /api/spatial/positions saves positions', async ({ request }) => {
    const res = await request.put('/api/spatial/positions', {
      headers: API_KEY_HEADER,
      data: {
        positions: [
          { agent_id: agentA.id, x: 100.5, y: 200.3 },
          { agent_id: agentB.id, x: 300, y: 400 },
        ],
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.count).toBe(2)
  })

  test('GET /api/spatial/positions returns saved positions', async ({ request }) => {
    const res = await request.get('/api/spatial/positions', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.positions.length).toBeGreaterThanOrEqual(2)

    const posA = body.positions.find((p: { agent_id: number }) => p.agent_id === agentA.id)
    expect(posA).toBeDefined()
    expect(posA.x).toBeCloseTo(100.5, 1)
    expect(posA.y).toBeCloseTo(200.3, 1)
  })

  test('PUT /api/spatial/positions rejects empty array', async ({ request }) => {
    const res = await request.put('/api/spatial/positions', {
      headers: API_KEY_HEADER,
      data: { positions: [] },
    })
    expect(res.status()).toBe(400)
  })

  test('PUT /api/spatial/positions upserts on conflict', async ({ request }) => {
    // Update agentA position
    const res = await request.put('/api/spatial/positions', {
      headers: API_KEY_HEADER,
      data: {
        positions: [{ agent_id: agentA.id, x: 999, y: 888 }],
      },
    })
    expect(res.status()).toBe(200)

    // Verify updated
    const getRes = await request.get('/api/spatial/positions', {
      headers: API_KEY_HEADER,
    })
    const body = await getRes.json()
    const posA = body.positions.find((p: { agent_id: number }) => p.agent_id === agentA.id)
    expect(posA.x).toBeCloseTo(999, 0)
    expect(posA.y).toBeCloseTo(888, 0)
  })

  // Cleanup relationship
  test('cleanup: delete remaining relationship', async ({ request }) => {
    if (relId1) {
      await request.delete(`/api/spatial/relationships/${relId1}`, {
        headers: API_KEY_HEADER,
      })
    }
  })
})
