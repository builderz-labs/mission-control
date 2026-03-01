import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestTask, deleteTestTask } from './helpers'

test.describe('Notifications', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestTask(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  // ── GET /api/notifications ───────────────────

  test('GET returns notifications for recipient', async ({ request }) => {
    // Create a task assigned to an agent (triggers notification)
    const { id } = await createTestTask(request, { assigned_to: 'notif-agent' })
    cleanup.push(id)

    const res = await request.get('/api/notifications?recipient=notif-agent', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.notifications).toBeDefined()
    expect(Array.isArray(body.notifications)).toBe(true)
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('unreadCount')
  })

  test('GET returns 400 without recipient param', async ({ request }) => {
    const res = await request.get('/api/notifications', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(400)
  })

  test('GET filters by unread_only', async ({ request }) => {
    const res = await request.get('/api/notifications?recipient=notif-agent&unread_only=true', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    // All returned notifications should be unread (read_at is null)
    for (const n of body.notifications) {
      expect(n.read_at).toBeNull()
    }
  })

  // ── POST /api/notifications ──────────────────

  test('POST marks notifications as delivered', async ({ request }) => {
    // Create assignment to trigger a notification
    const { id } = await createTestTask(request, { assigned_to: 'deliver-agent' })
    cleanup.push(id)

    const res = await request.post('/api/notifications', {
      headers: API_KEY_HEADER,
      data: { action: 'mark-delivered', agent: 'deliver-agent' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  test('POST rejects missing agent', async ({ request }) => {
    const res = await request.post('/api/notifications', {
      headers: API_KEY_HEADER,
      data: { action: 'mark-delivered' },
    })
    expect(res.status()).toBe(400)
  })

  // ── PUT /api/notifications ───────────────────

  test('PUT marks specific notification ids as read', async ({ request }) => {
    // Create assignment
    const { id: taskId } = await createTestTask(request, { assigned_to: 'read-agent' })
    cleanup.push(taskId)

    // Get the notification id
    const listRes = await request.get('/api/notifications?recipient=read-agent', {
      headers: API_KEY_HEADER,
    })
    const listBody = await listRes.json()
    const notifIds = listBody.notifications.map((n: any) => n.id)

    if (notifIds.length > 0) {
      const res = await request.put('/api/notifications', {
        headers: API_KEY_HEADER,
        data: { ids: notifIds },
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
    }
  })

  test('PUT marks all as read for recipient', async ({ request }) => {
    const res = await request.put('/api/notifications', {
      headers: API_KEY_HEADER,
      data: { recipient: 'read-agent', markAllRead: true },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
