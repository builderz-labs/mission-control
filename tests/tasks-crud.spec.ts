import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, createTestTask, deleteTestAgent, deleteTestTask } from './helpers'

test.describe('Tasks CRUD', () => {
  const cleanup: number[] = []
  const cleanupAgents: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestTask(request, id).catch(() => {})
    }
    cleanup.length = 0
    for (const id of cleanupAgents) {
      await deleteTestAgent(request, id).catch(() => {})
    }
    cleanupAgents.length = 0
  })

  // ── POST /api/tasks ──────────────────────────

  test('POST creates task with minimal fields (title only)', async ({ request }) => {
    const { id, res, body } = await createTestTask(request)
    cleanup.push(id)

    expect(res.status()).toBe(201)
    expect(body.task).toBeDefined()
    expect(body.task.title).toContain('e2e-task-')
    expect(body.task.status).toBe('inbox')
    expect(body.task.priority).toBe('medium')
  })

  test('POST creates task with all fields', async ({ request }) => {
    const { id, res, body } = await createTestTask(request, {
      description: 'Full task',
      status: 'assigned',
      priority: 'high',
      assigned_to: 'agent-x',
      tags: ['e2e', 'test'],
      metadata: { source: 'e2e' },
    })
    cleanup.push(id)

    expect(res.status()).toBe(201)
    expect(body.task.description).toBe('Full task')
    expect(body.task.status).toBe('assigned')
    expect(body.task.priority).toBe('high')
    expect(body.task.assigned_to).toBe('agent-x')
    expect(body.task.tags).toEqual(['e2e', 'test'])
    expect(body.task.metadata).toEqual({ source: 'e2e' })
  })

  test('POST rejects empty title', async ({ request }) => {
    const res = await request.post('/api/tasks', {
      headers: API_KEY_HEADER,
      data: { title: '' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST rejects duplicate title', async ({ request }) => {
    const { id, body: first } = await createTestTask(request)
    cleanup.push(id)

    const res = await request.post('/api/tasks', {
      headers: API_KEY_HEADER,
      data: { title: first.task.title },
    })
    expect(res.status()).toBe(409)
  })

  // ── GET /api/tasks ───────────────────────────

  test('GET list returns tasks with pagination shape', async ({ request }) => {
    const { id } = await createTestTask(request)
    cleanup.push(id)

    const res = await request.get('/api/tasks', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('tasks')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('page')
    expect(body).toHaveProperty('limit')
    expect(Array.isArray(body.tasks)).toBe(true)
  })

  test('GET list filters by status', async ({ request }) => {
    const { id } = await createTestTask(request, { status: 'review' })
    cleanup.push(id)

    const res = await request.get('/api/tasks?status=review', { headers: API_KEY_HEADER })
    const body = await res.json()
    for (const t of body.tasks) {
      expect(t.status).toBe('review')
    }
  })

  test('GET list filters by priority', async ({ request }) => {
    const { id } = await createTestTask(request, { priority: 'critical' })
    cleanup.push(id)

    const res = await request.get('/api/tasks?priority=critical', { headers: API_KEY_HEADER })
    const body = await res.json()
    for (const t of body.tasks) {
      expect(t.priority).toBe('critical')
    }
  })

  test('GET list respects limit and offset', async ({ request }) => {
    const res = await request.get('/api/tasks?limit=2&offset=0', { headers: API_KEY_HEADER })
    const body = await res.json()
    expect(body.tasks.length).toBeLessThanOrEqual(2)
    expect(body.limit).toBe(2)
  })

  // ── GET /api/tasks/[id] ──────────────────────

  test('GET single returns task by id', async ({ request }) => {
    const { id } = await createTestTask(request)
    cleanup.push(id)

    const res = await request.get(`/api/tasks/${id}`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.task).toBeDefined()
    expect(body.task.id).toBe(id)
  })

  test('GET single returns 404 for missing task', async ({ request }) => {
    const res = await request.get('/api/tasks/999999', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })

  test('GET single returns 400 for non-numeric id', async ({ request }) => {
    const res = await request.get('/api/tasks/abc', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(400)
  })

  // ── PUT /api/tasks/[id] ──────────────────────

  test('PUT updates task fields', async ({ request }) => {
    const { id } = await createTestTask(request)
    cleanup.push(id)

    const res = await request.put(`/api/tasks/${id}`, {
      headers: API_KEY_HEADER,
      data: { title: 'Updated title', priority: 'high' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.task.title).toBe('Updated title')
    expect(body.task.priority).toBe('high')
  })

  test('PUT updates assignee without resetting unrelated fields', async ({ request }) => {
    const agent = await createTestAgent(request)
    cleanupAgents.push(agent.id)

    const { id } = await createTestTask(request, {
      status: 'review',
      priority: 'high',
      tags: ['keep'],
      metadata: { source: 'e2e' },
    })
    cleanup.push(id)

    const res = await request.put(`/api/tasks/${id}`, {
      headers: API_KEY_HEADER,
      data: { assigned_to: agent.name },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.task.assigned_to).toBe(agent.name)
    expect(body.task.status).toBe('review')
    expect(body.task.priority).toBe('high')
    expect(body.task.tags).toEqual(['keep'])
    expect(body.task.metadata).toEqual({ source: 'e2e' })
  })

  test('PUT returns 404 for missing task', async ({ request }) => {
    const res = await request.put('/api/tasks/999999', {
      headers: API_KEY_HEADER,
      data: { title: 'no-op' },
    })
    expect(res.status()).toBe(404)
  })

  test('PUT with empty body returns 400', async ({ request }) => {
    const { id } = await createTestTask(request)
    cleanup.push(id)

    const res = await request.put(`/api/tasks/${id}`, {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect(res.status()).toBe(400)
  })

  test('PUT returns 403 when moving to done without Aegis approval', async ({ request }) => {
    const { id } = await createTestTask(request)
    cleanup.push(id)

    const res = await request.put(`/api/tasks/${id}`, {
      headers: API_KEY_HEADER,
      data: { status: 'done' },
    })
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('Aegis')
  })

  // ── DELETE /api/tasks/[id] ───────────────────

  test('DELETE removes task', async ({ request }) => {
    const { id } = await createTestTask(request)

    const res = await request.delete(`/api/tasks/${id}`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  test('DELETE returns 404 for missing task', async ({ request }) => {
    const res = await request.delete('/api/tasks/999999', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })

  // ── Full lifecycle ───────────────────────────

  test('full lifecycle: create → read → update → delete → confirm gone', async ({ request }) => {
    // Create
    const { id, res: createRes } = await createTestTask(request, { description: 'lifecycle test' })
    expect(createRes.status()).toBe(201)

    // Read
    const readRes = await request.get(`/api/tasks/${id}`, { headers: API_KEY_HEADER })
    expect(readRes.status()).toBe(200)
    const readBody = await readRes.json()
    expect(readBody.task.description).toBe('lifecycle test')

    // Update
    const updateRes = await request.put(`/api/tasks/${id}`, {
      headers: API_KEY_HEADER,
      data: { status: 'in_progress', priority: 'critical' },
    })
    expect(updateRes.status()).toBe(200)
    const updateBody = await updateRes.json()
    expect(updateBody.task.status).toBe('in_progress')
    expect(updateBody.task.priority).toBe('critical')

    // Delete
    const deleteRes = await request.delete(`/api/tasks/${id}`, { headers: API_KEY_HEADER })
    expect(deleteRes.status()).toBe(200)

    // Confirm gone
    const goneRes = await request.get(`/api/tasks/${id}`, { headers: API_KEY_HEADER })
    expect(goneRes.status()).toBe(404)
  })
})
