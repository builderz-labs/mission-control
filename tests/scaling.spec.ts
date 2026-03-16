import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Scaling API', () => {
  const policyCleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of policyCleanup) {
      await request.delete(`/api/scaling/policies/${id}`, {
        headers: API_KEY_HEADER,
      }).catch(() => {})
    }
    policyCleanup.length = 0
  })

  // ── Policies CRUD ────────────────────

  test('POST /scaling/policies creates a scaling policy', async ({ request }) => {
    const res = await request.post('/api/scaling/policies', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-policy-${Date.now()}`,
        min_agents: 1,
        max_agents: 5,
        scale_up_threshold: 0.7,
        scale_down_threshold: 0.2,
        cooldown_seconds: 60,
        idle_timeout_seconds: 120,
        auto_approve: false,
      },
    })

    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.policy).toBeDefined()
    expect(body.policy.name).toContain('e2e-policy-')
    expect(body.policy.min_agents).toBe(1)
    expect(body.policy.max_agents).toBe(5)
    policyCleanup.push(body.policy.id)
  })

  test('GET /scaling/policies lists policies', async ({ request }) => {
    // Create one first
    const create = await request.post('/api/scaling/policies', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-list-${Date.now()}`,
        min_agents: 0,
        max_agents: 10,
        scale_up_threshold: 0.8,
        scale_down_threshold: 0.2,
      },
    })
    const created = await create.json()
    policyCleanup.push(created.policy.id)

    const res = await request.get('/api/scaling/policies', {
      headers: API_KEY_HEADER,
    })

    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.policies).toBeDefined()
    expect(Array.isArray(body.policies)).toBe(true)
    expect(body.policies.length).toBeGreaterThanOrEqual(1)
  })

  test('PUT /scaling/policies/:id updates a policy', async ({ request }) => {
    const create = await request.post('/api/scaling/policies', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-update-${Date.now()}`,
        min_agents: 0,
        max_agents: 5,
        scale_up_threshold: 0.8,
        scale_down_threshold: 0.2,
      },
    })
    const created = await create.json()
    policyCleanup.push(created.policy.id)

    const res = await request.put(`/api/scaling/policies/${created.policy.id}`, {
      headers: API_KEY_HEADER,
      data: { max_agents: 20 },
    })

    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.policy.max_agents).toBe(20)
  })

  test('DELETE /scaling/policies/:id removes a policy', async ({ request }) => {
    const create = await request.post('/api/scaling/policies', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-delete-${Date.now()}`,
        min_agents: 0,
        max_agents: 5,
        scale_up_threshold: 0.8,
        scale_down_threshold: 0.2,
      },
    })
    const created = await create.json()

    const res = await request.delete(`/api/scaling/policies/${created.policy.id}`, {
      headers: API_KEY_HEADER,
    })

    expect(res.status()).toBe(200)

    // Verify it's gone
    const get = await request.get(`/api/scaling/policies/${created.policy.id}`, {
      headers: API_KEY_HEADER,
    })
    expect(get.status()).toBe(404)
  })

  // ── Validation ────────────────────

  test('POST /scaling/policies rejects scale_down >= scale_up thresholds', async ({ request }) => {
    const res = await request.post('/api/scaling/policies', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-invalid-${Date.now()}`,
        min_agents: 0,
        max_agents: 10,
        scale_up_threshold: 0.5,
        scale_down_threshold: 0.8,
      },
    })

    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('scale_down_threshold')
  })

  test('POST /scaling/policies rejects min_agents > max_agents', async ({ request }) => {
    const res = await request.post('/api/scaling/policies', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-invalid-min-${Date.now()}`,
        min_agents: 10,
        max_agents: 5,
        scale_up_threshold: 0.8,
        scale_down_threshold: 0.2,
      },
    })

    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('min_agents')
  })

  // ── Evaluation ────────────────────

  test('POST /scaling/evaluate triggers evaluation and returns result', async ({ request }) => {
    const create = await request.post('/api/scaling/policies', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-eval-${Date.now()}`,
        min_agents: 0,
        max_agents: 10,
        scale_up_threshold: 0.99,
        scale_down_threshold: 0.1,
        cooldown_seconds: 0,
      },
    })
    expect(create.status()).toBe(201)
    const created = await create.json()
    policyCleanup.push(created.policy.id)

    const res = await request.post('/api/scaling/evaluate', {
      headers: API_KEY_HEADER,
      data: { policyId: created.policy.id },
    })

    // 200 = no action needed, 201 = event created (depends on queue state from other tests)
    expect([200, 201]).toContain(res.status())
    const body = await res.json()
    expect(body.metrics).toBeDefined()
  })

  // ── Events ────────────────────

  test('GET /scaling/events returns event list', async ({ request }) => {
    const res = await request.get('/api/scaling/events', {
      headers: API_KEY_HEADER,
    })

    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.events).toBeDefined()
    expect(Array.isArray(body.events)).toBe(true)
  })

  // ── Auth ────────────────────

  test('401 without API key on policies', async ({ request }) => {
    const res = await request.get('/api/scaling/policies')
    expect(res.status()).toBe(401)
  })

  test('401 without API key on events', async ({ request }) => {
    const res = await request.get('/api/scaling/events')
    expect(res.status()).toBe(401)
  })

  test('401 without API key on evaluate', async ({ request }) => {
    const res = await request.post('/api/scaling/evaluate', {
      data: { policyId: 1 },
    })
    expect(res.status()).toBe(401)
  })
})
