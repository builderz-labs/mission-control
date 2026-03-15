import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('Debates API', () => {
  const agentCleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of agentCleanup) {
      await deleteTestAgent(request, id).catch(() => {})
    }
    agentCleanup.length = 0
  })

  // ── POST /api/debates/start ────────────────────

  test('POST /debates/start creates a debate with multiple participants', async ({ request }) => {
    const { id: id1 } = await createTestAgent(request, { role: 'debater-a' })
    agentCleanup.push(id1)
    const { id: id2 } = await createTestAgent(request, { role: 'debater-b' })
    agentCleanup.push(id2)

    const res = await request.post('/api/debates/start', {
      headers: API_KEY_HEADER,
      data: {
        topic: `e2e-debate-${Date.now()}`,
        participantIds: [id1, id2],
      },
    })

    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body).toBeDefined()
  })

  test('POST /debates/start accepts optional maxCycles and breakKeyword', async ({ request }) => {
    const { id: id1 } = await createTestAgent(request, { role: 'debater-a' })
    agentCleanup.push(id1)
    const { id: id2 } = await createTestAgent(request, { role: 'debater-b' })
    agentCleanup.push(id2)

    const res = await request.post('/api/debates/start', {
      headers: API_KEY_HEADER,
      data: {
        topic: `e2e-debate-opts-${Date.now()}`,
        participantIds: [id1, id2],
        maxCycles: 3,
        breakKeyword: 'CONSENSUS',
      },
    })

    expect(res.status()).toBe(201)
  })

  test('POST /debates/start rejects fewer than 2 participants', async ({ request }) => {
    const { id } = await createTestAgent(request)
    agentCleanup.push(id)

    const res = await request.post('/api/debates/start', {
      headers: API_KEY_HEADER,
      data: {
        topic: `e2e-debate-solo-${Date.now()}`,
        participantIds: [id],
      },
    })

    expect(res.status()).toBe(400)
  })

  test('POST /debates/start rejects missing topic', async ({ request }) => {
    const res = await request.post('/api/debates/start', {
      headers: API_KEY_HEADER,
      data: {
        participantIds: [1, 2],
      },
    })

    expect(res.status()).toBe(400)
  })

  test('POST /debates/start returns 401 without auth', async ({ request }) => {
    const res = await request.post('/api/debates/start', {
      data: {
        topic: 'unauthorized debate',
        participantIds: [1, 2],
      },
    })

    expect(res.status()).toBe(401)
  })
})
