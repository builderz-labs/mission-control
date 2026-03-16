import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('Conversations API', () => {
  const agentCleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of agentCleanup) {
      await deleteTestAgent(request, id).catch(() => {})
    }
    agentCleanup.length = 0
  })

  // ── POST /api/conversations/start ──────────────

  test('POST /conversations/start creates a conversation between two agents', async ({ request }) => {
    const { id: initiatorId } = await createTestAgent(request, { role: 'initiator' })
    agentCleanup.push(initiatorId)
    const { id: targetId } = await createTestAgent(request, { role: 'responder' })
    agentCleanup.push(targetId)

    const res = await request.post('/api/conversations/start', {
      headers: API_KEY_HEADER,
      data: {
        initiatorId,
        targetId,
        topic: `e2e-convo-${Date.now()}`,
      },
    })

    // 201 when LLM is configured, 500 when no LLM API key available
    if (res.status() === 201) {
      const body = await res.json()
      expect(body.conversationId).toBeDefined()
      expect(typeof body.conversationId).toBe('string')
    } else {
      expect(res.status()).toBe(500)
      const body = await res.json()
      expect(body.error).toBeDefined()
    }
  })

  test('POST /conversations/start accepts optional config', async ({ request }) => {
    const { id: initiatorId } = await createTestAgent(request, { role: 'initiator' })
    agentCleanup.push(initiatorId)
    const { id: targetId } = await createTestAgent(request, { role: 'responder' })
    agentCleanup.push(targetId)

    const res = await request.post('/api/conversations/start', {
      headers: API_KEY_HEADER,
      data: {
        initiatorId,
        targetId,
        topic: `e2e-convo-cfg-${Date.now()}`,
        config: {
          maxMessages: 10,
          maxDurationMs: 60000,
          needReflect: true,
        },
      },
    })

    // 201 when LLM is configured, 500 when no LLM API key available
    if (res.status() === 201) {
      const body = await res.json()
      expect(body.conversationId).toBeDefined()
    } else {
      expect(res.status()).toBe(500)
    }
  })

  test('POST /conversations/start rejects missing topic', async ({ request }) => {
    const { id: initiatorId } = await createTestAgent(request)
    agentCleanup.push(initiatorId)
    const { id: targetId } = await createTestAgent(request)
    agentCleanup.push(targetId)

    const res = await request.post('/api/conversations/start', {
      headers: API_KEY_HEADER,
      data: { initiatorId, targetId },
    })

    expect(res.status()).toBe(400)
  })

  test('POST /conversations/start rejects missing initiatorId', async ({ request }) => {
    const res = await request.post('/api/conversations/start', {
      headers: API_KEY_HEADER,
      data: { targetId: 1, topic: 'test' },
    })

    expect(res.status()).toBe(400)
  })

  test('POST /conversations/start returns 401 without auth', async ({ request }) => {
    const res = await request.post('/api/conversations/start', {
      data: { initiatorId: 1, targetId: 2, topic: 'test' },
    })

    expect(res.status()).toBe(401)
  })

  // ── GET /api/conversations/[id] ────────────────

  test('GET /conversations/:id returns 404 for non-existent conversation', async ({ request }) => {
    const res = await request.get('/api/conversations/nonexistent-conv-id-999', {
      headers: API_KEY_HEADER,
    })

    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  test('GET /conversations/:id returns 401 without auth', async ({ request }) => {
    const res = await request.get('/api/conversations/some-id')
    expect(res.status()).toBe(401)
  })

  // ── POST /api/conversations/[id]/continue ──────

  test('POST /conversations/:id/continue rejects missing responderId', async ({ request }) => {
    const res = await request.post('/api/conversations/some-conv-id/continue', {
      headers: API_KEY_HEADER,
      data: {},
    })

    expect(res.status()).toBe(400)
  })

  test('POST /conversations/:id/continue returns 401 without auth', async ({ request }) => {
    const res = await request.post('/api/conversations/some-conv-id/continue', {
      data: { responderId: 1 },
    })

    expect(res.status()).toBe(401)
  })

  // ── POST /api/conversations/[id]/leave ─────────

  test('POST /conversations/:id/leave rejects missing agentId', async ({ request }) => {
    const res = await request.post('/api/conversations/some-conv-id/leave', {
      headers: API_KEY_HEADER,
      data: {},
    })

    expect(res.status()).toBe(400)
  })

  test('POST /conversations/:id/leave returns 401 without auth', async ({ request }) => {
    const res = await request.post('/api/conversations/some-conv-id/leave', {
      data: { agentId: 1 },
    })

    expect(res.status()).toBe(401)
  })
})
