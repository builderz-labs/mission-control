import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('LLM Complete API', () => {
  const agentCleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of agentCleanup) {
      await deleteTestAgent(request, id).catch(() => {})
    }
    agentCleanup.length = 0
  })

  // ── POST /api/llm/complete ─────────────────────

  test('POST /llm/complete rejects missing messages', async ({ request }) => {
    const { id: agentId } = await createTestAgent(request)
    agentCleanup.push(agentId)

    const res = await request.post('/api/llm/complete', {
      headers: API_KEY_HEADER,
      data: {
        agentId,
      },
    })

    expect(res.status()).toBe(400)
  })

  test('POST /llm/complete rejects empty messages array', async ({ request }) => {
    const { id: agentId } = await createTestAgent(request)
    agentCleanup.push(agentId)

    const res = await request.post('/api/llm/complete', {
      headers: API_KEY_HEADER,
      data: {
        messages: [],
        agentId,
      },
    })

    expect(res.status()).toBe(400)
  })

  test('POST /llm/complete rejects missing agentId', async ({ request }) => {
    const res = await request.post('/api/llm/complete', {
      headers: API_KEY_HEADER,
      data: {
        messages: [{ role: 'user', content: 'hello' }],
      },
    })

    expect(res.status()).toBe(400)
  })

  test('POST /llm/complete rejects invalid message role', async ({ request }) => {
    const { id: agentId } = await createTestAgent(request)
    agentCleanup.push(agentId)

    const res = await request.post('/api/llm/complete', {
      headers: API_KEY_HEADER,
      data: {
        messages: [{ role: 'invalid-role', content: 'hello' }],
        agentId,
      },
    })

    expect(res.status()).toBe(400)
  })

  test('POST /llm/complete returns 401 without auth', async ({ request }) => {
    const res = await request.post('/api/llm/complete', {
      data: {
        messages: [{ role: 'user', content: 'hello' }],
        agentId: 1,
      },
    })

    expect(res.status()).toBe(401)
  })
})
