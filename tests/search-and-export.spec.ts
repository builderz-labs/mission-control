import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestTask, deleteTestTask } from './helpers'

test.describe('Search and Export', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestTask(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  // ── GET /api/search ──────────────────────────

  test('search returns results for valid query', async ({ request }) => {
    // Create a task with a searchable term
    const { id } = await createTestTask(request, { title: 'searchable-zebra-test' })
    cleanup.push(id)

    const res = await request.get('/api/search?q=searchable-zebra', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.query).toBe('searchable-zebra')
    expect(body.results).toBeDefined()
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })

  test('search returns 400 for short query', async ({ request }) => {
    const res = await request.get('/api/search?q=a', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(400)
  })

  test('search returns 400 for empty query', async ({ request }) => {
    const res = await request.get('/api/search?q=', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(400)
  })

  // ── GET /api/export ──────────────────────────

  test('export returns tasks as JSON', async ({ request }) => {
    const res = await request.get('/api/export?type=tasks&format=json', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.type).toBe('tasks')
    expect(body.data).toBeDefined()
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.count).toBeDefined()
  })

  test('export rejects missing type', async ({ request }) => {
    const res = await request.get('/api/export', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(400)
  })

  test('export rejects invalid type', async ({ request }) => {
    const res = await request.get('/api/export?type=invalid', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(400)
  })

  // ── GET /api/activities ──────────────────────

  test('activities returns activity feed', async ({ request }) => {
    const res = await request.get('/api/activities', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.activities).toBeDefined()
    expect(Array.isArray(body.activities)).toBe(true)
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('hasMore')
  })
})
