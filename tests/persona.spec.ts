import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('Persona API', () => {
  let agentId: number

  test.beforeAll(async ({ request }) => {
    const { id } = await createTestAgent(request)
    agentId = id
  })

  test.afterAll(async ({ request }) => {
    if (agentId) await deleteTestAgent(request, agentId)
  })

  test('GET /api/agents/[id]/persona returns defaults for new agent', async ({ request }) => {
    const res = await request.get(`/api/agents/${agentId}/persona`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(body.padState).toBeDefined()
    expect(body.padState.pleasure).toBe(0)
    expect(body.padState.arousal).toBe(0)
    expect(body.padState.dominance).toBe(0)
    expect(body.activeBiases).toEqual([])
    expect(body.trustNetwork).toEqual([])
    expect(body.presets).toContain('analytical-engineer')
    expect(body.presets).toContain('creative-designer')
  })

  test('PUT OCEAN traits and verify persistence', async ({ request }) => {
    const bigFive = {
      openness: 0.8,
      conscientiousness: 0.3,
      extraversion: 0.6,
      agreeableness: 0.9,
      neuroticism: 0.2,
    }

    const putRes = await request.put(`/api/agents/${agentId}/persona`, {
      headers: API_KEY_HEADER,
      data: { bigFive },
    })
    expect(putRes.status()).toBe(200)

    const putBody = await putRes.json()
    expect(putBody.persona.personality.big_five.openness).toBe(0.8)
    expect(putBody.persona.personality.big_five.conscientiousness).toBe(0.3)

    // Verify via GET
    const getRes = await request.get(`/api/agents/${agentId}/persona`, { headers: API_KEY_HEADER })
    const getBody = await getRes.json()
    expect(getBody.persona.personality.big_five.openness).toBe(0.8)
    expect(getBody.persona.personality.big_five.agreeableness).toBe(0.9)
  })

  test('Apply preset and verify traits updated', async ({ request }) => {
    const putRes = await request.put(`/api/agents/${agentId}/persona`, {
      headers: API_KEY_HEADER,
      data: { preset: 'cautious-reviewer' },
    })
    expect(putRes.status()).toBe(200)

    const getRes = await request.get(`/api/agents/${agentId}/persona`, { headers: API_KEY_HEADER })
    const body = await getRes.json()
    expect(body.persona.personality.big_five.openness).toBe(0.4)
    expect(body.persona.personality.big_five.conscientiousness).toBe(0.95)
  })

  test('Apply unknown preset returns 400', async ({ request }) => {
    const res = await request.put(`/api/agents/${agentId}/persona`, {
      headers: API_KEY_HEADER,
      data: { preset: 'nonexistent-preset' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Unknown preset')
  })

  test('PUT PAD state and verify', async ({ request }) => {
    const putRes = await request.put(`/api/agents/${agentId}/persona`, {
      headers: API_KEY_HEADER,
      data: { padState: { pleasure: 0.7, arousal: -0.5, dominance: 0.3 } },
    })
    expect(putRes.status()).toBe(200)
    expect(putRes.json()).resolves.toMatchObject({
      padState: {
        pleasure: 0.7,
        arousal: -0.5,
        dominance: 0.3,
      },
    })

    // Verify via GET
    const getRes = await request.get(`/api/agents/${agentId}/persona`, { headers: API_KEY_HEADER })
    const body = await getRes.json()
    expect(body.padState.pleasure).toBe(0.7)
    expect(body.padState.arousal).toBe(-0.5)
    expect(body.padState.dominance).toBe(0.3)
    expect(body.padState.updated_at).toBeGreaterThan(0)
  })

  test('Verify active biases match trait thresholds', async ({ request }) => {
    // Set profile with low openness + high conscientiousness = Confirmation + Anchoring + Sunk Cost
    const putRes = await request.put(`/api/agents/${agentId}/persona`, {
      headers: API_KEY_HEADER,
      data: {
        bigFive: {
          openness: 0.2,
          conscientiousness: 0.8,
          extraversion: 0.5,
          agreeableness: 0.5,
          neuroticism: 0.5,
        },
      },
    })
    expect(putRes.status()).toBe(200)

    const body = await putRes.json()
    const biasNames = body.activeBiases.map((b: { name: string }) => b.name)
    expect(biasNames).toContain('Confirmation Bias')
    expect(biasNames).toContain('Anchoring')
    expect(biasNames).toContain('Sunk Cost')
  })

  test('Neutral profile has no active biases', async ({ request }) => {
    const putRes = await request.put(`/api/agents/${agentId}/persona`, {
      headers: API_KEY_HEADER,
      data: {
        bigFive: {
          openness: 0.5,
          conscientiousness: 0.5,
          extraversion: 0.5,
          agreeableness: 0.5,
          neuroticism: 0.5,
        },
      },
    })
    expect(putRes.status()).toBe(200)
    const body = await putRes.json()
    expect(body.activeBiases).toEqual([])
  })

  test('GET persona for nonexistent agent returns 404', async ({ request }) => {
    const res = await request.get('/api/agents/999999/persona', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })

  test('PUT persona for nonexistent agent returns 404', async ({ request }) => {
    const res = await request.put('/api/agents/999999/persona', {
      headers: API_KEY_HEADER,
      data: { bigFive: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 } },
    })
    expect(res.status()).toBe(404)
  })

  test('401 without API key', async ({ request }) => {
    const res = await request.get(`/api/agents/${agentId}/persona`)
    expect(res.status()).toBe(401)
  })
})
