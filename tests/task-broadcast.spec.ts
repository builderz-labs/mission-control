import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestTask, deleteTestTask } from './helpers'

test.describe('Task Broadcast', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestTask(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  // ── POST /api/tasks/[id]/broadcast ────────────

  test('POST broadcast sends message to task subscribers', async ({ request }) => {
    const { id } = await createTestTask(request)
    cleanup.push(id)

    const res = await request.post(`/api/tasks/${id}/broadcast`, {
      headers: API_KEY_HEADER,
      data: { message: `E2E broadcast test at ${Date.now()}` },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('sent')
    expect(body).toHaveProperty('skipped')
    expect(typeof body.sent).toBe('number')
    expect(typeof body.skipped).toBe('number')
  })

  test('POST broadcast returns 404 for nonexistent task', async ({ request }) => {
    const res = await request.post('/api/tasks/999999/broadcast', {
      headers: API_KEY_HEADER,
      data: { message: 'Hello nonexistent task' },
    })
    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('not found')
  })

  test('POST broadcast returns 400 for invalid task ID', async ({ request }) => {
    const res = await request.post('/api/tasks/abc/broadcast', {
      headers: API_KEY_HEADER,
      data: { message: 'Invalid task id' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid task ID')
  })

  test('POST broadcast returns 400 when message is missing', async ({ request }) => {
    const { id } = await createTestTask(request)
    cleanup.push(id)

    const res = await request.post(`/api/tasks/${id}/broadcast`, {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Message is required')
  })

  test('POST broadcast returns 400 when message is empty string', async ({ request }) => {
    const { id } = await createTestTask(request)
    cleanup.push(id)

    const res = await request.post(`/api/tasks/${id}/broadcast`, {
      headers: API_KEY_HEADER,
      data: { message: '   ' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Message is required')
  })
})
