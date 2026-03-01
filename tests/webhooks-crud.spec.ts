import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestWebhook, deleteTestWebhook } from './helpers'

test.describe('Webhooks CRUD', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestWebhook(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  // ── POST /api/webhooks ───────────────────────

  test('POST creates webhook with name and valid URL', async ({ request }) => {
    const { id, res, body } = await createTestWebhook(request)
    cleanup.push(id)

    expect(res.status()).toBe(200) // webhook POST returns 200, not 201
    expect(body.id).toBeDefined()
    expect(body.name).toContain('e2e-webhook-')
    expect(body.secret).toBeDefined()
    expect(body.secret.length).toBeGreaterThan(10) // full secret shown on creation
    expect(body.enabled).toBe(true)
  })

  test('POST rejects invalid URL', async ({ request }) => {
    const res = await request.post('/api/webhooks', {
      headers: API_KEY_HEADER,
      data: { name: 'bad-url-hook', url: 'not-a-url' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST rejects missing name', async ({ request }) => {
    const res = await request.post('/api/webhooks', {
      headers: API_KEY_HEADER,
      data: { url: 'https://example.com/hook' },
    })
    expect(res.status()).toBe(400)
  })

  // ── GET /api/webhooks ────────────────────────

  test('GET returns webhooks with masked secrets', async ({ request }) => {
    const { id } = await createTestWebhook(request)
    cleanup.push(id)

    const res = await request.get('/api/webhooks', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.webhooks).toBeDefined()
    expect(Array.isArray(body.webhooks)).toBe(true)

    // Secrets should be masked in list response
    const found = body.webhooks.find((w: any) => w.id === id)
    expect(found).toBeDefined()
    expect(found.secret).toContain('••••••')
  })

  // ── PUT /api/webhooks ────────────────────────

  test('PUT updates webhook name', async ({ request }) => {
    const { id } = await createTestWebhook(request)
    cleanup.push(id)

    const res = await request.put('/api/webhooks', {
      headers: API_KEY_HEADER,
      data: { id, name: 'updated-hook' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  test('PUT regenerates secret', async ({ request }) => {
    const { id } = await createTestWebhook(request)
    cleanup.push(id)

    const res = await request.put('/api/webhooks', {
      headers: API_KEY_HEADER,
      data: { id, regenerate_secret: true },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.secret).toBeDefined()
    expect(body.secret.length).toBeGreaterThan(10)
  })

  test('PUT returns 404 for missing webhook', async ({ request }) => {
    const res = await request.put('/api/webhooks', {
      headers: API_KEY_HEADER,
      data: { id: 999999, name: 'nope' },
    })
    expect(res.status()).toBe(404)
  })

  // ── DELETE /api/webhooks ─────────────────────

  test('DELETE removes webhook', async ({ request }) => {
    const { id } = await createTestWebhook(request)

    const res = await request.delete('/api/webhooks', {
      headers: API_KEY_HEADER,
      data: { id },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  // ── Full lifecycle ───────────────────────────

  test('full lifecycle: create → read (masked) → update → delete', async ({ request }) => {
    // Create
    const { id, body: createBody } = await createTestWebhook(request)
    const fullSecret = createBody.secret
    expect(fullSecret.length).toBeGreaterThan(10)

    // Read (secret should be masked)
    const listRes = await request.get('/api/webhooks', { headers: API_KEY_HEADER })
    const listBody = await listRes.json()
    const found = listBody.webhooks.find((w: any) => w.id === id)
    expect(found.secret).toContain('••••••')
    expect(found.secret).not.toBe(fullSecret)

    // Update
    const updateRes = await request.put('/api/webhooks', {
      headers: API_KEY_HEADER,
      data: { id, name: 'lifecycle-hook' },
    })
    expect(updateRes.status()).toBe(200)

    // Delete
    const deleteRes = await request.delete('/api/webhooks', {
      headers: API_KEY_HEADER,
      data: { id },
    })
    expect(deleteRes.status()).toBe(200)
  })
})
