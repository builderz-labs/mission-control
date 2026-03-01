import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestWorkflow, deleteTestWorkflow } from './helpers'

test.describe('Workflows CRUD', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestWorkflow(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  // ── POST /api/workflows ──────────────────────

  test('POST creates workflow template', async ({ request }) => {
    const { id, res, body } = await createTestWorkflow(request)
    cleanup.push(id)

    expect(res.status()).toBe(201)
    expect(body.template).toBeDefined()
    expect(body.template.name).toContain('e2e-wf-')
    expect(body.template.task_prompt).toBe('Test prompt for e2e')
    expect(body.template.model).toBe('sonnet')
  })

  test('POST rejects missing name', async ({ request }) => {
    const res = await request.post('/api/workflows', {
      headers: API_KEY_HEADER,
      data: { task_prompt: 'prompt only' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST rejects missing task_prompt', async ({ request }) => {
    const res = await request.post('/api/workflows', {
      headers: API_KEY_HEADER,
      data: { name: 'name only' },
    })
    expect(res.status()).toBe(400)
  })

  // ── GET /api/workflows ───────────────────────

  test('GET returns templates array', async ({ request }) => {
    const { id } = await createTestWorkflow(request)
    cleanup.push(id)

    const res = await request.get('/api/workflows', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.templates).toBeDefined()
    expect(Array.isArray(body.templates)).toBe(true)
  })

  // ── PUT /api/workflows ───────────────────────

  test('PUT updates template fields', async ({ request }) => {
    const { id } = await createTestWorkflow(request)
    cleanup.push(id)

    const res = await request.put('/api/workflows', {
      headers: API_KEY_HEADER,
      data: { id, name: 'updated-wf-name', description: 'Updated desc' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.template.name).toBe('updated-wf-name')
    expect(body.template.description).toBe('Updated desc')
  })

  test('PUT returns 404 for missing template', async ({ request }) => {
    const res = await request.put('/api/workflows', {
      headers: API_KEY_HEADER,
      data: { id: 999999, name: 'nope' },
    })
    expect(res.status()).toBe(404)
  })

  // ── DELETE /api/workflows ────────────────────

  test('DELETE removes template', async ({ request }) => {
    const { id } = await createTestWorkflow(request)

    const res = await request.delete('/api/workflows', {
      headers: API_KEY_HEADER,
      data: { id },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  // ── Full lifecycle ───────────────────────────

  test('full lifecycle: create → list → update → delete', async ({ request }) => {
    // Create
    const { id, name, res: createRes } = await createTestWorkflow(request)
    expect(createRes.status()).toBe(201)

    // List
    const listRes = await request.get('/api/workflows', { headers: API_KEY_HEADER })
    const listBody = await listRes.json()
    expect(listBody.templates.some((t: any) => t.id === id)).toBe(true)

    // Update
    const updateRes = await request.put('/api/workflows', {
      headers: API_KEY_HEADER,
      data: { id, description: 'lifecycle update' },
    })
    expect(updateRes.status()).toBe(200)

    // Delete
    const deleteRes = await request.delete('/api/workflows', {
      headers: API_KEY_HEADER,
      data: { id },
    })
    expect(deleteRes.status()).toBe(200)
  })
})
