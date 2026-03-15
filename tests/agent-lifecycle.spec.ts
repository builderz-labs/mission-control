import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('Agent Lifecycle (soul, wake, memory, memories)', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestAgent(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  // ── GET /api/agents/[id]/soul ─────────────────

  test('GET soul returns content and source for agent', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.get(`/api/agents/${id}/soul`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('agent')
    expect(body.agent.id).toBe(id)
    expect(body).toHaveProperty('soul_content')
    expect(body).toHaveProperty('source')
    expect(['workspace', 'database', 'none']).toContain(body.source)
    expect(body).toHaveProperty('available_templates')
    expect(Array.isArray(body.available_templates)).toBe(true)
  })

  test('GET soul returns 404 for nonexistent agent', async ({ request }) => {
    const res = await request.get('/api/agents/999999/soul', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })

  // ── PUT /api/agents/[id]/soul ─────────────────

  test('PUT soul updates content in database', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const soulContent = `# Soul for E2E test agent ${Date.now()}`
    const res = await request.put(`/api/agents/${id}/soul`, {
      headers: API_KEY_HEADER,
      data: { soul_content: soulContent },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.soul_content).toBe(soulContent)
    expect(body).toHaveProperty('updated_at')

    // Verify with GET
    const getRes = await request.get(`/api/agents/${id}/soul`, { headers: API_KEY_HEADER })
    const getBody = await getRes.json()
    expect(getBody.soul_content).toBe(soulContent)
    expect(getBody.source).toBe('database')
  })

  test('PUT soul returns 404 for nonexistent agent', async ({ request }) => {
    const res = await request.put('/api/agents/999999/soul', {
      headers: API_KEY_HEADER,
      data: { soul_content: 'test' },
    })
    expect(res.status()).toBe(404)
  })

  // ── POST /api/agents/[id]/wake ────────────────

  test('POST wake returns 404 for nonexistent agent', async ({ request }) => {
    const res = await request.post('/api/agents/999999/wake', {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect(res.status()).toBe(404)
  })

  test('POST wake returns 400 when agent has no session key', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.post(`/api/agents/${id}/wake`, {
      headers: API_KEY_HEADER,
      data: { message: 'Wake up!' },
    })
    // Agent created via test helper has no session_key → 400
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('session key')
  })

  // ── GET /api/agents/[id]/memory (sovereign working memory) ──

  test('GET memory returns working memory for agent', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.get(`/api/agents/${id}/memory`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('agent')
    expect(body.agent.id).toBe(id)
    expect(body).toHaveProperty('working_memory')
    expect(body).toHaveProperty('size')
    expect(typeof body.size).toBe('number')
  })

  test('GET memory returns 404 for nonexistent agent', async ({ request }) => {
    const res = await request.get('/api/agents/999999/memory', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })

  // ── PUT /api/agents/[id]/memory ────────────────

  test('PUT memory updates working memory (replace mode)', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const content = `Working memory set at ${Date.now()}`
    const res = await request.put(`/api/agents/${id}/memory`, {
      headers: API_KEY_HEADER,
      data: { working_memory: content },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.working_memory).toBe(content)
    expect(body.size).toBe(content.length)

    // Verify with GET
    const getRes = await request.get(`/api/agents/${id}/memory`, { headers: API_KEY_HEADER })
    const getBody = await getRes.json()
    expect(getBody.working_memory).toBe(content)
  })

  test('PUT memory appends in append mode', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    // Set initial content
    await request.put(`/api/agents/${id}/memory`, {
      headers: API_KEY_HEADER,
      data: { working_memory: 'Initial note' },
    })

    // Append content
    const res = await request.put(`/api/agents/${id}/memory`, {
      headers: API_KEY_HEADER,
      data: { working_memory: 'Appended note', append: true },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.working_memory).toContain('Initial note')
    expect(body.working_memory).toContain('Appended note')
  })

  // ── DELETE /api/agents/[id]/memory ──────────────

  test('DELETE memory clears working memory', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    // Set some memory first
    await request.put(`/api/agents/${id}/memory`, {
      headers: API_KEY_HEADER,
      data: { working_memory: 'Some memory to clear' },
    })

    // Clear it
    const res = await request.delete(`/api/agents/${id}/memory`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.working_memory).toBe('')

    // Verify with GET
    const getRes = await request.get(`/api/agents/${id}/memory`, { headers: API_KEY_HEADER })
    const getBody = await getRes.json()
    expect(getBody.working_memory).toBe('')
  })

  // ── GET /api/agents/[id]/memories (Phase 1 agent-memory system) ──

  test('GET memories timeline returns array for agent', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.get(`/api/agents/${id}/memories`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('memories')
    expect(Array.isArray(body.memories)).toBe(true)
  })

  test('GET memories with action=stats returns stats', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.get(`/api/agents/${id}/memories?action=stats`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    // Stats should return some object (exact shape depends on implementation)
    expect(typeof body).toBe('object')
  })

  test('GET memories returns 404 for nonexistent agent', async ({ request }) => {
    const res = await request.get('/api/agents/999999/memories', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })

  // ── POST /api/agents/[id]/memories ─────────────

  test('POST memories observe action creates a memory', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.post(`/api/agents/${id}/memories`, {
      headers: API_KEY_HEADER,
      data: {
        action: 'observe',
        description: `E2E test observation at ${Date.now()}`,
        importance: 5,
      },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body).toHaveProperty('memoryId')
    expect(typeof body.memoryId).toBe('number')
  })

  test('POST memories returns 400 for missing action', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.post(`/api/agents/${id}/memories`, {
      headers: API_KEY_HEADER,
      data: { description: 'No action field' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('action')
  })

  test('POST memories returns 400 for unknown action', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.post(`/api/agents/${id}/memories`, {
      headers: API_KEY_HEADER,
      data: { action: 'nonexistent' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Unknown action')
  })

  test('POST memories observe validates description is required', async ({ request }) => {
    const { id } = await createTestAgent(request)
    cleanup.push(id)

    const res = await request.post(`/api/agents/${id}/memories`, {
      headers: API_KEY_HEADER,
      data: { action: 'observe' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST memories returns 404 for nonexistent agent', async ({ request }) => {
    const res = await request.post('/api/agents/999999/memories', {
      headers: API_KEY_HEADER,
      data: { action: 'observe', description: 'test' },
    })
    expect(res.status()).toBe(404)
  })
})
