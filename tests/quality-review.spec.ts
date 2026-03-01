import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestTask, deleteTestTask } from './helpers'

test.describe('Quality Review', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestTask(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  // ── POST /api/quality-review ─────────────────

  test('POST creates review for existing task', async ({ request }) => {
    const { id: taskId } = await createTestTask(request)
    cleanup.push(taskId)

    const res = await request.post('/api/quality-review', {
      headers: API_KEY_HEADER,
      data: {
        taskId,
        reviewer: 'aegis',
        status: 'approved',
        notes: 'Looks good to me',
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.id).toBeDefined()
  })

  test('POST returns 404 for non-existent task', async ({ request }) => {
    const res = await request.post('/api/quality-review', {
      headers: API_KEY_HEADER,
      data: {
        taskId: 999999,
        reviewer: 'aegis',
        status: 'rejected',
        notes: 'Task does not exist',
      },
    })
    expect(res.status()).toBe(404)
  })

  test('POST rejects missing required fields', async ({ request }) => {
    const { id: taskId } = await createTestTask(request)
    cleanup.push(taskId)

    const res = await request.post('/api/quality-review', {
      headers: API_KEY_HEADER,
      data: { taskId },
    })
    expect(res.status()).toBe(400)
  })

  // ── GET /api/quality-review ──────────────────

  test('GET returns reviews for taskId', async ({ request }) => {
    const { id: taskId } = await createTestTask(request)
    cleanup.push(taskId)

    // Create a review first
    await request.post('/api/quality-review', {
      headers: API_KEY_HEADER,
      data: {
        taskId,
        reviewer: 'aegis',
        status: 'approved',
        notes: 'LGTM',
      },
    })

    const res = await request.get(`/api/quality-review?taskId=${taskId}`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.reviews).toBeDefined()
    expect(Array.isArray(body.reviews)).toBe(true)
    expect(body.reviews.length).toBeGreaterThanOrEqual(1)
  })

  test('GET batch lookup by taskIds', async ({ request }) => {
    const { id: taskId1 } = await createTestTask(request)
    const { id: taskId2 } = await createTestTask(request)
    cleanup.push(taskId1, taskId2)

    // Create review for task1
    await request.post('/api/quality-review', {
      headers: API_KEY_HEADER,
      data: { taskId: taskId1, reviewer: 'aegis', status: 'approved', notes: 'ok' },
    })

    const res = await request.get(`/api/quality-review?taskIds=${taskId1},${taskId2}`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.latest).toBeDefined()
    expect(body.latest[taskId1]).not.toBeNull()
    expect(body.latest[taskId2]).toBeNull() // no review for task2
  })

  test('GET returns 400 without taskId', async ({ request }) => {
    const res = await request.get('/api/quality-review', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(400)
  })
})
