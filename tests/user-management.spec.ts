import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestUser, deleteTestUser } from './helpers'

test.describe('User Management', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestUser(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  // ── POST /api/auth/users ─────────────────────

  test('POST creates user', async ({ request }) => {
    const { id, res, body } = await createTestUser(request)
    cleanup.push(id)

    expect(res.status()).toBe(201)
    expect(body.user).toBeDefined()
    expect(body.user.username).toContain('e2e-user-')
    expect(body.user.role).toBe('operator')
  })

  test('POST rejects duplicate username', async ({ request }) => {
    const { id, body: first } = await createTestUser(request)
    cleanup.push(id)

    const res = await request.post('/api/auth/users', {
      headers: API_KEY_HEADER,
      data: {
        username: first.user.username,
        password: 'testpass123',
      },
    })
    expect(res.status()).toBe(409)
  })

  test('POST rejects missing username', async ({ request }) => {
    const res = await request.post('/api/auth/users', {
      headers: API_KEY_HEADER,
      data: { password: 'testpass123' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST rejects missing password', async ({ request }) => {
    const res = await request.post('/api/auth/users', {
      headers: API_KEY_HEADER,
      data: { username: 'no-password-user' },
    })
    expect(res.status()).toBe(400)
  })

  // ── GET /api/auth/users ──────────────────────

  test('GET returns users list', async ({ request }) => {
    const res = await request.get('/api/auth/users', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.users).toBeDefined()
    expect(Array.isArray(body.users)).toBe(true)
  })

  // ── PUT /api/auth/users ──────────────────────

  test('PUT updates display_name and role', async ({ request }) => {
    const { id } = await createTestUser(request)
    cleanup.push(id)

    const res = await request.put('/api/auth/users', {
      headers: API_KEY_HEADER,
      data: { id, display_name: 'Updated Name', role: 'viewer' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.user.display_name).toBe('Updated Name')
    expect(body.user.role).toBe('viewer')
  })

  test('PUT returns 404 for missing user', async ({ request }) => {
    const res = await request.put('/api/auth/users', {
      headers: API_KEY_HEADER,
      data: { id: 999999, display_name: 'nope' },
    })
    expect(res.status()).toBe(404)
  })

  // ── DELETE /api/auth/users ───────────────────

  test('DELETE removes user', async ({ request }) => {
    const { id } = await createTestUser(request)

    const res = await request.delete('/api/auth/users', {
      headers: API_KEY_HEADER,
      data: { id },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  test('DELETE returns 404 for missing user', async ({ request }) => {
    const res = await request.delete('/api/auth/users', {
      headers: API_KEY_HEADER,
      data: { id: 999999 },
    })
    expect(res.status()).toBe(404)
  })
})
