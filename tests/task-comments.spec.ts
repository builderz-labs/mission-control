import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestTask, deleteTestTask } from './helpers'

test.describe('Task Comments', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestTask(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  // ── POST /api/tasks/[id]/comments ────────────

  test('POST adds comment to existing task', async ({ request }) => {
    const { id } = await createTestTask(request)
    cleanup.push(id)

    const res = await request.post(`/api/tasks/${id}/comments`, {
      headers: API_KEY_HEADER,
      data: { content: 'Test comment from e2e' },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.comment).toBeDefined()
    expect(body.comment.content).toBe('Test comment from e2e')
    expect(body.comment.task_id).toBe(id)
  })

  test('POST rejects empty content', async ({ request }) => {
    const { id } = await createTestTask(request)
    cleanup.push(id)

    const res = await request.post(`/api/tasks/${id}/comments`, {
      headers: API_KEY_HEADER,
      data: { content: '' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST returns 404 for non-existent task', async ({ request }) => {
    const res = await request.post('/api/tasks/999999/comments', {
      headers: API_KEY_HEADER,
      data: { content: 'orphan comment' },
    })
    expect(res.status()).toBe(404)
  })

  test('POST creates threaded reply', async ({ request }) => {
    const { id } = await createTestTask(request)
    cleanup.push(id)

    // Create parent comment
    const parentRes = await request.post(`/api/tasks/${id}/comments`, {
      headers: API_KEY_HEADER,
      data: { content: 'Parent comment' },
    })
    const parentBody = await parentRes.json()
    const parentId = parentBody.comment.id

    // Create reply
    const replyRes = await request.post(`/api/tasks/${id}/comments`, {
      headers: API_KEY_HEADER,
      data: { content: 'Reply comment', parent_id: parentId },
    })
    expect(replyRes.status()).toBe(201)
    const replyBody = await replyRes.json()
    expect(replyBody.comment.parent_id).toBe(parentId)
  })

  // ── GET /api/tasks/[id]/comments ─────────────

  test('GET returns comments array for task', async ({ request }) => {
    const { id } = await createTestTask(request)
    cleanup.push(id)

    // Add a comment
    await request.post(`/api/tasks/${id}/comments`, {
      headers: API_KEY_HEADER,
      data: { content: 'First comment' },
    })

    const res = await request.get(`/api/tasks/${id}/comments`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.comments).toBeDefined()
    expect(Array.isArray(body.comments)).toBe(true)
    expect(body.comments.length).toBeGreaterThanOrEqual(1)
    expect(body.total).toBeGreaterThanOrEqual(1)
  })

  test('GET returns empty array for task with no comments', async ({ request }) => {
    const { id } = await createTestTask(request)
    cleanup.push(id)

    const res = await request.get(`/api/tasks/${id}/comments`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.comments).toEqual([])
    expect(body.total).toBe(0)
  })

  test('GET returns 404 for non-existent task', async ({ request }) => {
    const res = await request.get('/api/tasks/999999/comments', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })
})
