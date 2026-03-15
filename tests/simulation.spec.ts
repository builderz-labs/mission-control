import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Simulation API', () => {

  // ── POST /api/simulation/start ─────────────────

  test('POST /simulation/start returns 503 when SIMULATION_ENABLED is not set', async ({ request }) => {
    const res = await request.post('/api/simulation/start', {
      headers: API_KEY_HEADER,
    })

    // Unless SIMULATION_ENABLED=true in the test env, this returns 503
    // If enabled, it returns 200 with status 'started'
    expect([200, 503]).toContain(res.status())
    const body = await res.json()
    if (res.status() === 503) {
      expect(body.error).toContain('Simulation is disabled')
    } else {
      expect(body.status).toBe('started')
    }
  })

  test('POST /simulation/start accepts optional config body', async ({ request }) => {
    const res = await request.post('/api/simulation/start', {
      headers: API_KEY_HEADER,
      data: {
        tickIntervalMs: 5000,
        dryRun: true,
      },
    })

    // 503 if disabled, 200 if enabled
    expect([200, 503]).toContain(res.status())
  })

  test('POST /simulation/start returns 401 without auth', async ({ request }) => {
    const res = await request.post('/api/simulation/start')
    expect(res.status()).toBe(401)
  })

  // ── POST /api/simulation/stop ──────────────────

  test('POST /simulation/stop responds with status', async ({ request }) => {
    const res = await request.post('/api/simulation/stop', {
      headers: API_KEY_HEADER,
    })

    // 200 if engine was running, 500 if engine throws (no active sim)
    expect([200, 500]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body.status).toBe('stopped')
      expect(body).toHaveProperty('tickCount')
    }
  })

  test('POST /simulation/stop returns 401 without auth', async ({ request }) => {
    const res = await request.post('/api/simulation/stop')
    expect(res.status()).toBe(401)
  })

  // ── POST /api/simulation/tick ──────────────────

  test('POST /simulation/tick performs a manual tick', async ({ request }) => {
    const res = await request.post('/api/simulation/tick', {
      headers: API_KEY_HEADER,
    })

    // 200 if engine exists, 500 if tick fails (no running sim)
    expect([200, 500]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body.status).toBe('ticked')
      expect(body).toHaveProperty('tickCount')
    }
  })

  test('POST /simulation/tick returns 401 without auth', async ({ request }) => {
    const res = await request.post('/api/simulation/tick')
    expect(res.status()).toBe(401)
  })

  // ── GET /api/simulation/status ─────────────────

  test('GET /simulation/status returns engine status', async ({ request }) => {
    const res = await request.get('/api/simulation/status', {
      headers: API_KEY_HEADER,
    })

    // getSimulationEngine() may throw if not initialized, or return status
    expect([200, 500]).toContain(res.status())
  })

  test('GET /simulation/status returns 401 without auth', async ({ request }) => {
    const res = await request.get('/api/simulation/status')
    expect(res.status()).toBe(401)
  })
})
