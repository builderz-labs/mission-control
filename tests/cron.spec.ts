import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Cron Jobs API', () => {
  // ── GET /api/cron ─────────────────────────────────

  test('GET with action=list returns jobs array', async ({ request }) => {
    const res = await request.get('/api/cron?action=list', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('jobs')
    expect(Array.isArray(body.jobs)).toBe(true)
  })

  test('GET rejects missing action parameter', async ({ request }) => {
    const res = await request.get('/api/cron', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid action')
  })

  test('GET rejects invalid action parameter', async ({ request }) => {
    const res = await request.get('/api/cron?action=unknown', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid action')
  })

  test('GET logs requires job ID', async ({ request }) => {
    const res = await request.get('/api/cron?action=logs', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Job ID required')
  })

  test('GET logs returns logs array for any job id', async ({ request }) => {
    const res = await request.get('/api/cron?action=logs&job=nonexistent-job', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('logs')
    expect(Array.isArray(body.logs)).toBe(true)
  })

  test('GET rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/cron?action=list')
    expect(res.status()).toBe(401)
  })

  // ── POST /api/cron ────────────────────────────────

  test('POST toggle rejects missing job identifier', async ({ request }) => {
    const res = await request.post('/api/cron', {
      headers: API_KEY_HEADER,
      data: { action: 'toggle' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Job ID or name required')
  })

  test('POST toggle returns 404 for nonexistent job', async ({ request }) => {
    const res = await request.post('/api/cron', {
      headers: API_KEY_HEADER,
      data: { action: 'toggle', jobId: `nonexistent-${Date.now()}` },
    })
    // Returns 404 (not found) or 404 (no cron file)
    expect([404]).toContain(res.status())
  })

  test('POST add rejects missing required fields', async ({ request }) => {
    const res = await request.post('/api/cron', {
      headers: API_KEY_HEADER,
      data: { action: 'add', name: 'test-job' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('required')
  })

  test('POST remove rejects missing job identifier', async ({ request }) => {
    const res = await request.post('/api/cron', {
      headers: API_KEY_HEADER,
      data: { action: 'remove' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Job ID or name required')
  })

  test('POST rejects invalid action', async ({ request }) => {
    const res = await request.post('/api/cron', {
      headers: API_KEY_HEADER,
      data: { action: 'invalid-action' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid action')
  })

  test('POST trigger rejects missing job identifier', async ({ request }) => {
    const res = await request.post('/api/cron', {
      headers: API_KEY_HEADER,
      data: { action: 'trigger' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Job ID required')
  })
})
