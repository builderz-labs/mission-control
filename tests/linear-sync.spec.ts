import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Linear Sync API', () => {
  test('GET /api/linear requires auth', async ({ request }) => {
    const res = await request.get('/api/linear')
    expect(res.status()).toBe(401)
  })

  test('GET /api/linear returns error without LINEAR_API_KEY', async ({ request }) => {
    const res = await request.get('/api/linear', {
      headers: API_KEY_HEADER,
    })
    // Either 400 (token not configured) or 500 (API error) are acceptable
    expect([400, 500]).toContain(res.status())
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  test('POST /api/linear with action=status returns sync history', async ({ request }) => {
    const res = await request.post('/api/linear', {
      headers: API_KEY_HEADER,
      data: { action: 'status' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.syncs).toBeDefined()
    expect(Array.isArray(body.syncs)).toBe(true)
  })

  test('POST /api/linear with action=sync-project requires project_id', async ({ request }) => {
    const res = await request.post('/api/linear', {
      headers: API_KEY_HEADER,
      data: { action: 'sync-project' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/linear with invalid project_id returns 404', async ({ request }) => {
    const res = await request.post('/api/linear', {
      headers: API_KEY_HEADER,
      data: { action: 'sync-project', project_id: 999999 },
    })
    expect(res.status()).toBe(404)
  })

  test('POST /api/linear rejects invalid action', async ({ request }) => {
    const res = await request.post('/api/linear', {
      headers: API_KEY_HEADER,
      data: { action: 'invalid-action' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })
})
