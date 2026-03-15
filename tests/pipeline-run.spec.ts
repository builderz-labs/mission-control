import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Pipeline Run API', () => {
  // ── GET /api/pipelines/run ────────────────────────

  test('GET returns pipeline runs list', async ({ request }) => {
    const res = await request.get('/api/pipelines/run', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('runs')
    expect(Array.isArray(body.runs)).toBe(true)
  })

  test('GET with id returns 404 for nonexistent run', async ({ request }) => {
    const res = await request.get('/api/pipelines/run?id=999999', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Run not found')
  })

  test('GET rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/pipelines/run')
    expect(res.status()).toBe(401)
  })

  // ── POST /api/pipelines/run ───────────────────────

  test('POST rejects invalid action', async ({ request }) => {
    const res = await request.post('/api/pipelines/run', {
      headers: API_KEY_HEADER,
      data: { action: 'invalid-action' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid action')
  })

  test('POST start returns 404 for nonexistent pipeline', async ({ request }) => {
    const res = await request.post('/api/pipelines/run', {
      headers: API_KEY_HEADER,
      data: { action: 'start', pipeline_id: 999999 },
    })
    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Pipeline not found')
  })

  test('POST advance returns 400 without run_id', async ({ request }) => {
    const res = await request.post('/api/pipelines/run', {
      headers: API_KEY_HEADER,
      data: { action: 'advance' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('run_id required')
  })

  test('POST cancel returns 404 for nonexistent run', async ({ request }) => {
    const res = await request.post('/api/pipelines/run', {
      headers: API_KEY_HEADER,
      data: { action: 'cancel', run_id: 999999 },
    })
    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Run not found')
  })
})
