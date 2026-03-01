import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAlert, deleteTestAlert } from './helpers'

test.describe('Alerts CRUD', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestAlert(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  // ── POST /api/alerts ─────────────────────────

  test('POST creates alert rule with all required fields', async ({ request }) => {
    const { id, res, body } = await createTestAlert(request)
    cleanup.push(id)

    expect(res.status()).toBe(201)
    expect(body.rule).toBeDefined()
    expect(body.rule.name).toContain('e2e-alert-')
    expect(body.rule.entity_type).toBe('task')
    expect(body.rule.condition_operator).toBe('equals')
  })

  test('POST rejects missing required fields', async ({ request }) => {
    const res = await request.post('/api/alerts', {
      headers: API_KEY_HEADER,
      data: { name: 'incomplete-alert' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST rejects invalid entity_type', async ({ request }) => {
    const res = await request.post('/api/alerts', {
      headers: API_KEY_HEADER,
      data: {
        name: 'bad-entity',
        entity_type: 'invalid',
        condition_field: 'status',
        condition_operator: 'equals',
        condition_value: 'test',
      },
    })
    expect(res.status()).toBe(400)
  })

  // ── GET /api/alerts ──────────────────────────

  test('GET returns rules array', async ({ request }) => {
    const { id } = await createTestAlert(request)
    cleanup.push(id)

    const res = await request.get('/api/alerts', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.rules).toBeDefined()
    expect(Array.isArray(body.rules)).toBe(true)
  })

  // ── PUT /api/alerts ──────────────────────────

  test('PUT updates alert rule fields', async ({ request }) => {
    const { id } = await createTestAlert(request)
    cleanup.push(id)

    const res = await request.put('/api/alerts', {
      headers: API_KEY_HEADER,
      data: { id, name: 'updated-alert', description: 'Updated desc' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.rule.name).toBe('updated-alert')
    expect(body.rule.description).toBe('Updated desc')
  })

  test('PUT returns 404 for missing rule', async ({ request }) => {
    const res = await request.put('/api/alerts', {
      headers: API_KEY_HEADER,
      data: { id: 999999, name: 'nope' },
    })
    expect(res.status()).toBe(404)
  })

  // ── DELETE /api/alerts ───────────────────────

  test('DELETE removes alert rule', async ({ request }) => {
    const { id } = await createTestAlert(request)

    const res = await request.delete('/api/alerts', {
      headers: API_KEY_HEADER,
      data: { id },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.deleted).toBe(true)
  })

  // ── Full lifecycle ───────────────────────────

  test('full lifecycle: create → list → update → delete', async ({ request }) => {
    // Create
    const { id, res: createRes } = await createTestAlert(request)
    expect(createRes.status()).toBe(201)

    // List
    const listRes = await request.get('/api/alerts', { headers: API_KEY_HEADER })
    const listBody = await listRes.json()
    expect(listBody.rules.some((r: any) => r.id === id)).toBe(true)

    // Update
    const updateRes = await request.put('/api/alerts', {
      headers: API_KEY_HEADER,
      data: { id, enabled: 0 },
    })
    expect(updateRes.status()).toBe(200)

    // Delete
    const deleteRes = await request.delete('/api/alerts', {
      headers: API_KEY_HEADER,
      data: { id },
    })
    expect(deleteRes.status()).toBe(200)
  })
})
