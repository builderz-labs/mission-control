import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'
import type { APIRequestContext } from '@playwright/test'

test.describe('Projects CRUD', () => {
  const cleanup: number[] = []

  async function createProject(request: APIRequestContext, overrides: Record<string, unknown> = {}) {
    const name = `e2e-proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const res = await request.post('/api/projects', {
      headers: API_KEY_HEADER,
      data: { name, ...overrides },
    })
    const body = await res.json()
    return { id: body.project?.id as number, name, res, body }
  }

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await request.delete(`/api/projects/${id}?mode=delete`, {
        headers: API_KEY_HEADER,
      }).catch(() => {})
    }
    cleanup.length = 0
  })

  // -- POST /api/projects ---------------------------------

  test('POST creates project with name only', async ({ request }) => {
    const { id, res, body } = await createProject(request)
    cleanup.push(id)

    expect(res.status()).toBe(201)
    expect(body.project).toBeDefined()
    expect(body.project.name).toContain('e2e-proj-')
    expect(typeof body.project.slug).toBe('string')
    expect(body.project.slug.length).toBeGreaterThan(0)
    expect(typeof body.project.ticket_prefix).toBe('string')
    expect(body.project.ticket_prefix.length).toBeGreaterThan(0)
    expect(body.project.status).toBe('active')
  })

  test('POST rejects empty name', async ({ request }) => {
    const res = await request.post('/api/projects', {
      headers: API_KEY_HEADER,
      data: {},
    })
    expect(res.status()).toBe(400)
  })

  test('POST rejects duplicate slug', async ({ request }) => {
    const { id, body: first } = await createProject(request)
    cleanup.push(id)

    // Create a second project with the same name to trigger slug collision
    const res = await request.post('/api/projects', {
      headers: API_KEY_HEADER,
      data: { name: first.project.name },
    })
    expect(res.status()).toBe(409)
  })

  // -- GET /api/projects ----------------------------------

  test('GET list returns projects array', async ({ request }) => {
    const { id } = await createProject(request)
    cleanup.push(id)

    const res = await request.get('/api/projects', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('projects')
    expect(Array.isArray(body.projects)).toBe(true)
  })

  // -- GET /api/projects/[id] -----------------------------

  test('GET single by id', async ({ request }) => {
    const { id, name } = await createProject(request)
    cleanup.push(id)

    const res = await request.get(`/api/projects/${id}`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.project.id).toBe(id)
    expect(body.project.name).toBe(name)
  })

  test('GET single returns 404 for missing', async ({ request }) => {
    const res = await request.get('/api/projects/999999', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })

  test('GET single returns 400 for non-numeric id', async ({ request }) => {
    const res = await request.get('/api/projects/not-a-number', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(400)
  })

  // -- PATCH /api/projects/[id] ---------------------------

  test('PATCH updates name', async ({ request }) => {
    const { id } = await createProject(request)
    cleanup.push(id)

    const newName = `e2e-proj-renamed-${Date.now()}`
    const res = await request.patch(`/api/projects/${id}`, {
      headers: API_KEY_HEADER,
      data: { name: newName },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.project.name).toBe(newName)
  })

  test('PATCH returns 404 for missing project', async ({ request }) => {
    const res = await request.patch('/api/projects/999999', {
      headers: API_KEY_HEADER,
      data: { name: 'ghost' },
    })
    expect(res.status()).toBe(404)
  })

  // -- DELETE /api/projects/[id] --------------------------

  test('DELETE archives by default', async ({ request }) => {
    const { id } = await createProject(request)
    // No cleanup push -- we are deleting inline and then hard-deleting below

    const res = await request.delete(`/api/projects/${id}`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('archive')

    // Hard-delete to clean up
    await request.delete(`/api/projects/${id}?mode=delete`, {
      headers: API_KEY_HEADER,
    }).catch(() => {})
  })

  // -- Full lifecycle -------------------------------------

  test('full lifecycle: create -> read -> update -> archive', async ({ request }) => {
    // Create
    const { id, name, res: createRes } = await createProject(request)
    expect(createRes.status()).toBe(201)

    // Read
    const readRes = await request.get(`/api/projects/${id}`, { headers: API_KEY_HEADER })
    expect(readRes.status()).toBe(200)
    const readBody = await readRes.json()
    expect(readBody.project.name).toBe(name)
    expect(readBody.project.status).toBe('active')

    // Update
    const updatedName = `e2e-proj-updated-${Date.now()}`
    const updateRes = await request.patch(`/api/projects/${id}`, {
      headers: API_KEY_HEADER,
      data: { name: updatedName },
    })
    expect(updateRes.status()).toBe(200)
    const updateBody = await updateRes.json()
    expect(updateBody.project.name).toBe(updatedName)

    // Archive (default delete mode)
    const archiveRes = await request.delete(`/api/projects/${id}`, { headers: API_KEY_HEADER })
    expect(archiveRes.status()).toBe(200)
    const archiveBody = await archiveRes.json()
    expect(archiveBody.mode).toBe('archive')

    // Hard-delete to clean up
    await request.delete(`/api/projects/${id}?mode=delete`, {
      headers: API_KEY_HEADER,
    }).catch(() => {})
  })
})
