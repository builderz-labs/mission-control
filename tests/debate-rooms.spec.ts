import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('Debate Rooms API', () => {
  const agentCleanup: number[] = []
  const debateCleanup: number[] = []

  test.afterAll(async ({ request }) => {
    // Clean up debates
    for (const id of debateCleanup) {
      await request.delete('/api/debates', {
        headers: API_KEY_HEADER,
        data: { id },
      }).catch(() => {})
    }
    // Clean up agents
    for (const id of agentCleanup) {
      await deleteTestAgent(request, id).catch(() => {})
    }
  })

  // ── Helpers ──

  async function createDebate(
    request: import('@playwright/test').APIRequestContext,
    participantIds: number[],
    overrides: Record<string, unknown> = {}
  ) {
    const res = await request.post('/api/debates', {
      headers: API_KEY_HEADER,
      data: {
        topic: `e2e-debate-${Date.now()}`,
        participantIds,
        maxRounds: 3,
        tokenBudget: 100000,
        ...overrides,
      },
    })
    const body = await res.json()
    if (body.debate?.id) debateCleanup.push(body.debate.id)
    return { res, body, id: body.debate?.id as number }
  }

  // ── CRUD + Lifecycle ──

  test.describe('Debate CRUD', () => {
    let agentA: { id: number; name: string }
    let agentB: { id: number; name: string }

    test.beforeAll(async ({ request }) => {
      const a = await createTestAgent(request, { role: 'debater' })
      const b = await createTestAgent(request, { role: 'debater' })
      agentA = { id: a.id, name: a.body.agent.name }
      agentB = { id: b.id, name: b.body.agent.name }
      agentCleanup.push(a.id, b.id)
    })

    test('POST /debates creates a debate with 2 agents', async ({ request }) => {
      const { res, body } = await createDebate(request, [agentA.id, agentB.id])
      expect(res.status()).toBe(201)
      expect(body.debate).toBeDefined()
      expect(body.debate.topic).toContain('e2e-debate-')
      expect(body.debate.status).toBe('propose')
      expect(body.debate.current_round).toBe(1)
    })

    test('POST /debates rejects fewer than 2 participants', async ({ request }) => {
      const res = await request.post('/api/debates', {
        headers: API_KEY_HEADER,
        data: {
          topic: 'solo-debate',
          participantIds: [agentA.id],
          maxRounds: 3,
          tokenBudget: 100000,
        },
      })
      expect(res.status()).toBe(400)
    })

    test('POST /debates rejects missing topic', async ({ request }) => {
      const res = await request.post('/api/debates', {
        headers: API_KEY_HEADER,
        data: {
          participantIds: [agentA.id, agentB.id],
          maxRounds: 3,
          tokenBudget: 100000,
        },
      })
      expect(res.status()).toBe(400)
    })

    test('GET /debates lists debates', async ({ request }) => {
      // Create one first
      await createDebate(request, [agentA.id, agentB.id])

      const res = await request.get('/api/debates', {
        headers: API_KEY_HEADER,
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.debates)).toBe(true)
      expect(body.debates.length).toBeGreaterThan(0)
      expect(body.total).toBeGreaterThan(0)
    })

    test('GET /debates filters by status', async ({ request }) => {
      const res = await request.get('/api/debates?status=propose', {
        headers: API_KEY_HEADER,
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      for (const d of body.debates) {
        expect(d.status).toBe('propose')
      }
    })

    test('GET /debates/[id] returns full debate detail', async ({ request }) => {
      const { id } = await createDebate(request, [agentA.id, agentB.id])

      const res = await request.get(`/api/debates/${id}`, {
        headers: API_KEY_HEADER,
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.debate.id).toBe(id)
      expect(body.participants).toHaveLength(2)
      expect(body.arguments).toHaveLength(0)
      expect(body.votes).toHaveLength(0)
    })

    test('GET /debates/[id] returns 404 for nonexistent', async ({ request }) => {
      const res = await request.get('/api/debates/999999', {
        headers: API_KEY_HEADER,
      })
      expect(res.status()).toBe(404)
    })

    test('DELETE /debates deletes a debate', async ({ request }) => {
      const { id } = await createDebate(request, [agentA.id, agentB.id])

      const delRes = await request.delete('/api/debates', {
        headers: API_KEY_HEADER,
        data: { id },
      })
      expect(delRes.status()).toBe(200)

      // Verify gone
      const getRes = await request.get(`/api/debates/${id}`, {
        headers: API_KEY_HEADER,
      })
      expect(getRes.status()).toBe(404)

      // Remove from cleanup since already deleted
      const idx = debateCleanup.indexOf(id)
      if (idx !== -1) debateCleanup.splice(idx, 1)
    })
  })

  // ── Full Lifecycle ──

  test.describe('Debate Lifecycle', () => {
    let agentA: { id: number; name: string }
    let agentB: { id: number; name: string }

    test.beforeAll(async ({ request }) => {
      const a = await createTestAgent(request, { role: 'debater' })
      const b = await createTestAgent(request, { role: 'debater' })
      agentA = { id: a.id, name: a.body.agent.name }
      agentB = { id: b.id, name: b.body.agent.name }
      agentCleanup.push(a.id, b.id)
    })

    test('full debate cycle: propose → critique → rebut → vote → concluded', async ({ request }) => {
      // Create debate
      const { id } = await createDebate(request, [agentA.id, agentB.id], { maxRounds: 1 })

      // Submit propose arguments
      let argRes = await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentA.id, content: 'I propose we proceed with plan A.', confidence: 0.9 },
      })
      expect(argRes.status()).toBe(201)

      argRes = await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentB.id, content: 'I propose plan B is better.', confidence: 0.8 },
      })
      expect(argRes.status()).toBe(201)

      // Advance to critique
      let advRes = await request.post(`/api/debates/${id}/advance`, { headers: API_KEY_HEADER })
      expect(advRes.status()).toBe(200)
      let advBody = await advRes.json()
      expect(advBody.status).toBe('critique')

      // Submit critique arguments
      await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentA.id, content: 'Plan B has scalability issues.', confidence: 0.7 },
      })
      await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentB.id, content: 'Plan A is too expensive.', confidence: 0.6 },
      })

      // Advance to rebut
      advRes = await request.post(`/api/debates/${id}/advance`, { headers: API_KEY_HEADER })
      advBody = await advRes.json()
      expect(advBody.status).toBe('rebut')

      // Submit rebuttals
      await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentA.id, content: 'Cost is manageable with optimization.', confidence: 0.85 },
      })
      await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentB.id, content: 'Scaling concerns were addressed in v2.', confidence: 0.75 },
      })

      // Advance to vote
      advRes = await request.post(`/api/debates/${id}/advance`, { headers: API_KEY_HEADER })
      advBody = await advRes.json()
      expect(advBody.status).toBe('vote')

      // Cast votes — both accept
      let voteRes = await request.post(`/api/debates/${id}/vote`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentA.id, vote: 'accept', reason: 'Plan A wins' },
      })
      expect(voteRes.status()).toBe(201)
      let voteBody = await voteRes.json()
      expect(voteBody.allVoted).toBe(false)

      voteRes = await request.post(`/api/debates/${id}/vote`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentB.id, vote: 'accept', reason: 'Convinced by rebuttal' },
      })
      expect(voteRes.status()).toBe(201)
      voteBody = await voteRes.json()
      expect(voteBody.allVoted).toBe(true)
      expect(voteBody.accept).toBe(2)
      expect(voteBody.reject).toBe(0)

      // Advance — should conclude with accepted
      advRes = await request.post(`/api/debates/${id}/advance`, { headers: API_KEY_HEADER })
      advBody = await advRes.json()
      expect(advBody.status).toBe('concluded')

      // Verify results
      const resultRes = await request.get(`/api/debates/${id}/results`, { headers: API_KEY_HEADER })
      expect(resultRes.status()).toBe(200)
      const results = await resultRes.json()
      expect(results.debate.outcome).toBe('accepted')
      expect(results.voteTally.accept).toBe(2)
      expect(results.voteTally.reject).toBe(0)
      expect(Object.keys(results.argumentsByRound)).toHaveLength(1)
    })

    test('argument submission rejected for non-participant', async ({ request }) => {
      const { id } = await createDebate(request, [agentA.id, agentB.id])

      // Create a third agent not in the debate
      const c = await createTestAgent(request, { role: 'outsider' })
      agentCleanup.push(c.id)

      const res = await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: c.id, content: 'I want to join!', confidence: 0.5 },
      })
      expect(res.status()).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('not a participant')
    })

    test('duplicate argument for same round+phase rejected', async ({ request }) => {
      const { id } = await createDebate(request, [agentA.id, agentB.id])

      // First argument succeeds
      const res1 = await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentA.id, content: 'First proposal', confidence: 0.8 },
      })
      expect(res1.status()).toBe(201)

      // Second argument same phase+round fails
      const res2 = await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentA.id, content: 'Second proposal', confidence: 0.9 },
      })
      expect(res2.status()).toBe(400)
      const body = await res2.json()
      expect(body.error).toContain('already submitted')
    })

    test('vote rejected when not in vote phase', async ({ request }) => {
      const { id } = await createDebate(request, [agentA.id, agentB.id])
      // Debate is in propose phase, not vote

      const res = await request.post(`/api/debates/${id}/vote`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentA.id, vote: 'accept' },
      })
      expect(res.status()).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('not in voting')
    })

    test('advance rejected on concluded debate', async ({ request }) => {
      // Create and immediately conclude via full cycle
      const { id } = await createDebate(request, [agentA.id, agentB.id], { maxRounds: 1 })

      // Quick cycle through
      await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentA.id, content: 'Proposal', confidence: 0.8 },
      })
      await request.post(`/api/debates/${id}/advance`, { headers: API_KEY_HEADER }) // → critique
      await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentA.id, content: 'Critique', confidence: 0.7 },
      })
      await request.post(`/api/debates/${id}/advance`, { headers: API_KEY_HEADER }) // → rebut
      await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentA.id, content: 'Rebuttal', confidence: 0.8 },
      })
      await request.post(`/api/debates/${id}/advance`, { headers: API_KEY_HEADER }) // → vote

      await request.post(`/api/debates/${id}/vote`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentA.id, vote: 'accept' },
      })
      await request.post(`/api/debates/${id}/vote`, {
        headers: API_KEY_HEADER,
        data: { agentId: agentB.id, vote: 'accept' },
      })
      await request.post(`/api/debates/${id}/advance`, { headers: API_KEY_HEADER }) // → concluded

      // Try to advance again
      const res = await request.post(`/api/debates/${id}/advance`, { headers: API_KEY_HEADER })
      expect(res.status()).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('already ended')
    })
  })

  // ── Token Budget ──

  test.describe('Token Budget', () => {
    test('debate exhausts budget on large argument', async ({ request }) => {
      const a = await createTestAgent(request, { role: 'debater' })
      const b = await createTestAgent(request, { role: 'debater' })
      agentCleanup.push(a.id, b.id)

      // Create with tiny budget (100 tokens ~ 400 chars)
      const { id } = await createDebate(request, [a.id, b.id], { tokenBudget: 100 })

      // Submit argument that exceeds budget
      const longContent = 'x'.repeat(500) // ~125 tokens
      const res = await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: a.id, content: longContent, confidence: 0.8 },
      })
      expect(res.status()).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('budget')

      // Verify debate status is budget_exhausted
      const detailRes = await request.get(`/api/debates/${id}`, { headers: API_KEY_HEADER })
      const detail = await detailRes.json()
      expect(detail.debate.status).toBe('budget_exhausted')
    })
  })

  // ── Multi-round ──

  test.describe('Multi-round debate', () => {
    test('debate advances to round 2 when vote rejects in round 1', async ({ request }) => {
      const a = await createTestAgent(request, { role: 'debater' })
      const b = await createTestAgent(request, { role: 'debater' })
      agentCleanup.push(a.id, b.id)

      const { id } = await createDebate(request, [a.id, b.id], { maxRounds: 2 })

      // Round 1 cycle
      await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: a.id, content: 'Round 1 proposal', confidence: 0.8 },
      })
      await request.post(`/api/debates/${id}/advance`, { headers: API_KEY_HEADER }) // → critique
      await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: a.id, content: 'Round 1 critique', confidence: 0.7 },
      })
      await request.post(`/api/debates/${id}/advance`, { headers: API_KEY_HEADER }) // → rebut
      await request.post(`/api/debates/${id}/arguments`, {
        headers: API_KEY_HEADER,
        data: { agentId: a.id, content: 'Round 1 rebuttal', confidence: 0.8 },
      })
      await request.post(`/api/debates/${id}/advance`, { headers: API_KEY_HEADER }) // → vote

      // Both reject
      await request.post(`/api/debates/${id}/vote`, {
        headers: API_KEY_HEADER,
        data: { agentId: a.id, vote: 'reject', reason: 'Not convinced' },
      })
      await request.post(`/api/debates/${id}/vote`, {
        headers: API_KEY_HEADER,
        data: { agentId: b.id, vote: 'reject', reason: 'Needs more work' },
      })

      // Advance — should go to round 2 propose
      const advRes = await request.post(`/api/debates/${id}/advance`, { headers: API_KEY_HEADER })
      const advBody = await advRes.json()
      expect(advBody.status).toBe('propose')
      expect(advBody.round).toBe(2)

      // Verify debate is in round 2
      const detailRes = await request.get(`/api/debates/${id}`, { headers: API_KEY_HEADER })
      const detail = await detailRes.json()
      expect(detail.debate.current_round).toBe(2)
      expect(detail.debate.status).toBe('propose')
    })
  })

  // ── Auth ──

  test.describe('Auth', () => {
    test('GET /debates returns 401 without auth', async ({ request }) => {
      const res = await request.get('/api/debates')
      expect(res.status()).toBe(401)
    })

    test('POST /debates returns 401 without auth', async ({ request }) => {
      const res = await request.post('/api/debates', {
        data: { topic: 'unauthorized', participantIds: [1, 2], maxRounds: 3, tokenBudget: 100000 },
      })
      expect(res.status()).toBe(401)
    })
  })
})
