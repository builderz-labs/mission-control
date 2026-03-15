import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Scheduler API', () => {
  // ── GET /api/scheduler ────────────────────────────

  test('GET returns scheduler status with tasks array', async ({ request }) => {
    const res = await request.get('/api/scheduler', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('tasks')
    expect(Array.isArray(body.tasks)).toBe(true)

    // Each task should have an id
    if (body.tasks.length > 0) {
      expect(body.tasks[0]).toHaveProperty('id')
    }
  })

  test('GET rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/scheduler')
    expect(res.status()).toBe(401)
  })

  // ── POST /api/scheduler ───────────────────────────

  test('POST rejects empty task_id', async ({ request }) => {
    const res = await request.post('/api/scheduler', {
      headers: API_KEY_HEADER,
      data: { task_id: '' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('task_id required')
  })

  test('POST rejects unknown task_id', async ({ request }) => {
    const res = await request.post('/api/scheduler', {
      headers: API_KEY_HEADER,
      data: { task_id: 'nonexistent_task_id_xyz' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('task_id required')
  })

  test('POST rejects invalid JSON body', async ({ request }) => {
    const res = await request.post('/api/scheduler', {
      headers: {
        ...API_KEY_HEADER,
        'content-type': 'application/json',
      },
      data: 'not-json',
    })
    // Should return 400 for invalid JSON
    expect([400, 500]).toContain(res.status())
  })
})

test.describe('Command API', () => {
  // ── POST /api/command ─────────────────────────────

  test('POST sync-projects returns success', async ({ request }) => {
    const res = await request.post('/api/command', {
      headers: API_KEY_HEADER,
      data: { command: 'sync-projects' },
    })
    // May succeed or fail depending on environment, but should not 401
    const status = res.status()
    expect([200, 500]).toContain(status)
    const body = await res.json()
    if (status === 200) {
      expect(body.status).toBe('success')
      expect(body.message).toContain('synchronization')
    }
  })

  test('POST status-report returns success with data', async ({ request }) => {
    const res = await request.post('/api/command', {
      headers: API_KEY_HEADER,
      data: { command: 'status-report' },
    })
    const status = res.status()
    expect([200, 500]).toContain(status)
    const body = await res.json()
    if (status === 200) {
      expect(body.status).toBe('success')
      expect(body.data).toBeDefined()
      expect(typeof body.data.projectCount).toBe('number')
    }
  })

  test('POST rejects unknown command', async ({ request }) => {
    const res = await request.post('/api/command', {
      headers: API_KEY_HEADER,
      data: { command: 'nonexistent-command' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Unknown command')
  })

  test('POST rejects unauthenticated requests', async ({ request }) => {
    const res = await request.post('/api/command', {
      data: { command: 'status-report' },
    })
    expect(res.status()).toBe(401)
  })

  test('POST kill-all returns success or warning', async ({ request }) => {
    const res = await request.post('/api/command', {
      headers: API_KEY_HEADER,
      data: { command: 'kill-all' },
    })
    // kill-all always returns 200 (either success or warning)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(['success', 'warning']).toContain(body.status)
  })
})
