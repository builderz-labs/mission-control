import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Onboarding API', () => {
  // Reset onboarding state before each test to ensure isolation
  test.beforeEach(async ({ request }) => {
    await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'reset' },
    })
  })

  // ── Auth ─────────────────────────────────────

  test('GET /api/onboarding returns 401 without auth', async ({ request }) => {
    const res = await request.get('/api/onboarding')
    expect(res.status()).toBe(401)
  })

  test('POST /api/onboarding returns 401 without auth', async ({ request }) => {
    const res = await request.post('/api/onboarding', {
      data: { action: 'reset' },
    })
    expect(res.status()).toBe(401)
  })

  // ── GET ──────────────────────────────────────

  test('GET returns onboarding state with valid auth', async ({ request }) => {
    const res = await request.get('/api/onboarding', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('showOnboarding')
    expect(body).toHaveProperty('completed')
    expect(body).toHaveProperty('skipped')
    expect(body).toHaveProperty('checklistDismissed')
    expect(body).toHaveProperty('currentStep')
    expect(body).toHaveProperty('steps')
  })

  test('GET steps array has expected onboarding steps with id/title/completed', async ({ request }) => {
    const res = await request.get('/api/onboarding', { headers: API_KEY_HEADER })
    const body = await res.json()
    expect(body.steps).toHaveLength(5)
    expect(body.steps.map((step: any) => step.id)).toEqual([
      'welcome',
      'interface-mode',
      'gateway-link',
      'agent-runtimes',
      'credentials',
    ])
    for (const step of body.steps) {
      expect(step).toHaveProperty('id')
      expect(step).toHaveProperty('title')
      expect(step).toHaveProperty('completed')
      expect(typeof step.id).toBe('string')
      expect(typeof step.title).toBe('string')
      expect(typeof step.completed).toBe('boolean')
    }
  })

  // ── POST: complete_step ──────────────────────

  test('POST complete_step marks step completed', async ({ request }) => {
    const res = await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'complete_step', step: 'welcome' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.completedSteps).toContain('welcome')
  })

  test('POST complete_step without step returns 400', async ({ request }) => {
    const res = await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'complete_step' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST complete_step with invalid step returns 400', async ({ request }) => {
    const res = await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'complete_step', step: 'nonexistent' },
    })
    expect(res.status()).toBe(400)
  })

  // ── POST: skip ───────────────────────────────

  test('POST skip sets skipped, GET reflects showOnboarding=false', async ({ request }) => {
    const skipRes = await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'skip' },
    })
    expect(skipRes.status()).toBe(200)

    const getRes = await request.get('/api/onboarding', { headers: API_KEY_HEADER })
    const state = await getRes.json()
    expect(state.skipped).toBe(true)
    expect(state.showOnboarding).toBe(false)
  })

  // ── POST: complete ───────────────────────────

  test('POST complete sets completed', async ({ request }) => {
    const res = await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'complete' },
    })
    expect(res.status()).toBe(200)

    const getRes = await request.get('/api/onboarding', { headers: API_KEY_HEADER })
    const state = await getRes.json()
    expect(state.completed).toBe(true)
    expect(state.showOnboarding).toBe(false)
  })

  test('POST dismiss_checklist is persisted per user in onboarding state', async ({ request }) => {
    const res = await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'dismiss_checklist' },
    })
    expect(res.status()).toBe(200)

    const getRes = await request.get('/api/onboarding', { headers: API_KEY_HEADER })
    const state = await getRes.json()
    expect(state.checklistDismissed).toBe(true)
  })

  // ── POST: reset ──────────────────────────────

  test('POST reset clears all state', async ({ request }) => {
    // First complete onboarding and dismiss checklist
    await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'complete' },
    })
    await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'dismiss_checklist' },
    })

    // Reset
    const res = await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'reset' },
    })
    expect(res.status()).toBe(200)

    // Verify onboarding state
    const getRes = await request.get('/api/onboarding', { headers: API_KEY_HEADER })
    const state = await getRes.json()
    expect(state.completed).toBe(false)
    expect(state.skipped).toBe(false)
    expect(state.checklistDismissed).toBe(false)
    expect(state.steps.every((s: any) => s.completed === false)).toBe(true)
  })

  // ── POST: invalid action ─────────────────────

  test('POST with invalid action returns 400', async ({ request }) => {
    const res = await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'invalid_action' },
    })
    expect(res.status()).toBe(400)
  })

  // ── Full lifecycle ───────────────────────────

  test('full lifecycle: reset -> steps -> complete -> verify', async ({ request }) => {
    // Reset
    await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'reset' },
    })

    // Verify initial state shows onboarding
    const initial = await request.get('/api/onboarding', { headers: API_KEY_HEADER })
    const initialState = await initial.json()
    expect(initialState.completed).toBe(false)
    expect(initialState.skipped).toBe(false)

    // Complete all configured steps
    for (const stepId of ['welcome', 'interface-mode', 'gateway-link', 'agent-runtimes', 'credentials']) {
      const res = await request.post('/api/onboarding', {
        headers: API_KEY_HEADER,
        data: { action: 'complete_step', step: stepId },
      })
      expect(res.status()).toBe(200)
    }

    // Mark complete
    const completeRes = await request.post('/api/onboarding', {
      headers: API_KEY_HEADER,
      data: { action: 'complete' },
    })
    expect(completeRes.status()).toBe(200)

    // Verify done
    const final = await request.get('/api/onboarding', { headers: API_KEY_HEADER })
    const finalState = await final.json()
    expect(finalState.completed).toBe(true)
    expect(finalState.showOnboarding).toBe(false)
    expect(finalState.steps.every((s: any) => s.completed === true)).toBe(true)
  })
})
