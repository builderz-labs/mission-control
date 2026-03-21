import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestProject, deleteTestProject } from './helpers'

test.describe('Projects CRUD', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await deleteTestProject(request, id).catch(() => {})
    }
    cleanup.length = 0
  })

  // ── POST /api/projects ──────────────────────────

  test('POST creates project with minimal fields (name only)', async ({ request }) => {
    const { id, res, body } = await createTestProject(request)
    cleanup.push(id)

    expect(res.status()).toBe(201)
    expect(body.project).toBeDefined()
    expect(body.project.name).toContain('e2e-project-')
    expect(body.project.status).toBe('active')
    expect(body.project.slug).toBeTruthy()
    expect(body.project.ticket_prefix).toBeTruthy()
  })

  test('POST creates project with all enhanced fields', async ({ request }) => {
    const { id, res, body } = await createTestProject(request, {
      description: 'Full project for e2e',
      ticket_prefix: 'E2EFULL',
      workflow_mode: 'edict_v1',
      github_repo: 'test-org/test-repo',
      deadline: Math.floor(Date.now() / 1000) + 86400,
      color: '#3b82f6',
    })
    cleanup.push(id)

    expect(res.status()).toBe(201)
    expect(body.project.description).toBe('Full project for e2e')
    expect(body.project.ticket_prefix).toBe('E2EFULL')
    expect(body.project.workflow_mode).toBe('edict_v1')
    expect(body.project.workflow_template).toBe('edict_v1')
    expect(body.project.github_repo).toBe('test-org/test-repo')
    expect(body.project.deadline).toBeGreaterThan(0)
    expect(body.project.color).toBe('#3b82f6')
  })

  test('POST rejects empty name', async ({ request }) => {
    const res = await request.post('/api/projects', {
      headers: API_KEY_HEADER,
      data: { name: '' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST rejects duplicate slug', async ({ request }) => {
    const { id } = await createTestProject(request, { name: 'Duplicate Test Project' })
    cleanup.push(id)

    const res = await request.post('/api/projects', {
      headers: API_KEY_HEADER,
      data: { name: 'Duplicate Test Project' },
    })
    expect(res.status()).toBe(409)
  })

  // ── GET /api/projects ───────────────────────────

  test('GET list returns projects with enhanced fields', async ({ request }) => {
    const { id } = await createTestProject(request, {
      description: 'Listed project',
      github_repo: 'org/repo',
      color: '#ef4444',
    })
    cleanup.push(id)

    const res = await request.get('/api/projects', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('projects')
    expect(Array.isArray(body.projects)).toBe(true)

    const found = body.projects.find((p: any) => p.id === id)
    expect(found).toBeDefined()
    expect(found.github_repo).toBe('org/repo')
    expect(found.color).toBe('#ef4444')
    expect(typeof found.task_count).toBe('number')
    expect(Array.isArray(found.assigned_agents)).toBe(true)
  })

  test('GET list excludes archived by default', async ({ request }) => {
    const { id } = await createTestProject(request)
    cleanup.push(id)

    // Archive the project
    await request.patch(`/api/projects/${id}`, {
      headers: API_KEY_HEADER,
      data: { status: 'archived' },
    })

    const res = await request.get('/api/projects', { headers: API_KEY_HEADER })
    const body = await res.json()
    const found = body.projects.find((p: any) => p.id === id)
    expect(found).toBeUndefined()

    // But includeArchived=1 should show it
    const resArchived = await request.get('/api/projects?includeArchived=1', { headers: API_KEY_HEADER })
    const bodyArchived = await resArchived.json()
    const foundArchived = bodyArchived.projects.find((p: any) => p.id === id)
    expect(foundArchived).toBeDefined()
    expect(foundArchived.status).toBe('archived')
  })

  // ── GET /api/projects/[id] ──────────────────────

  test('GET single returns enriched project', async ({ request }) => {
    const { id } = await createTestProject(request, {
      description: 'Single project',
      github_repo: 'owner/repo',
      color: '#10b981',
    })
    cleanup.push(id)

    const res = await request.get(`/api/projects/${id}`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.project).toBeDefined()
    expect(body.project.id).toBe(id)
    expect(body.project.github_repo).toBe('owner/repo')
    expect(body.project.color).toBe('#10b981')
    expect(typeof body.project.task_count).toBe('number')
    expect(Array.isArray(body.project.assigned_agents)).toBe(true)
  })

  test('GET single returns 404 for missing project', async ({ request }) => {
    const res = await request.get('/api/projects/999999', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })

  // ── PATCH /api/projects/[id] ────────────────────

  test('PATCH updates basic fields', async ({ request }) => {
    const { id } = await createTestProject(request)
    cleanup.push(id)

    const res = await request.patch(`/api/projects/${id}`, {
      headers: API_KEY_HEADER,
      data: { name: 'Updated Project Name', description: 'Updated description' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.project.name).toBe('Updated Project Name')
    expect(body.project.description).toBe('Updated description')
  })

  test('PATCH updates enhanced fields (github_repo, deadline, color)', async ({ request }) => {
    const { id } = await createTestProject(request)
    cleanup.push(id)

    const deadline = Math.floor(Date.now() / 1000) + 172800
    const res = await request.patch(`/api/projects/${id}`, {
      headers: API_KEY_HEADER,
      data: {
        workflow_mode: 'edict_v1',
        github_repo: 'new-org/new-repo',
        deadline,
        color: '#8b5cf6',
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.project.workflow_mode).toBe('edict_v1')
    expect(body.project.github_repo).toBe('new-org/new-repo')
    expect(body.project.deadline).toBe(deadline)
    expect(body.project.color).toBe('#8b5cf6')
  })

  test('PATCH can clear optional fields with null', async ({ request }) => {
    const { id } = await createTestProject(request, {
      github_repo: 'will-clear/repo',
      color: '#ef4444',
    })
    cleanup.push(id)

    const res = await request.patch(`/api/projects/${id}`, {
      headers: API_KEY_HEADER,
      data: { github_repo: null, color: null, deadline: null },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.project.github_repo).toBeNull()
    expect(body.project.color).toBeNull()
    expect(body.project.deadline).toBeNull()
  })

  test('PATCH returns 404 for missing project', async ({ request }) => {
    const res = await request.patch('/api/projects/999999', {
      headers: API_KEY_HEADER,
      data: { name: 'no-op' },
    })
    expect(res.status()).toBe(404)
  })

  test('PATCH rejects archiving default project', async ({ request }) => {
    // Get the general project
    const listRes = await request.get('/api/projects?includeArchived=1', { headers: API_KEY_HEADER })
    const listBody = await listRes.json()
    const general = listBody.projects.find((p: any) => p.slug === 'general')
    expect(general).toBeDefined()

    const res = await request.patch(`/api/projects/${general.id}`, {
      headers: API_KEY_HEADER,
      data: { status: 'archived' },
    })
    expect(res.status()).toBe(400)
  })

  // ── DELETE /api/projects/[id] ───────────────────

  test('DELETE archives project by default', async ({ request }) => {
    const { id } = await createTestProject(request)

    const res = await request.delete(`/api/projects/${id}`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('archive')

    // Verify it's archived, not deleted
    const getRes = await request.get(`/api/projects/${id}`, { headers: API_KEY_HEADER })
    expect(getRes.status()).toBe(200)
    const getBody = await getRes.json()
    expect(getBody.project.status).toBe('archived')
  })

  test('DELETE with mode=delete permanently removes project', async ({ request }) => {
    const { id } = await createTestProject(request)

    const res = await request.delete(`/api/projects/${id}?mode=delete`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('delete')

    // Verify it's gone
    const getRes = await request.get(`/api/projects/${id}`, { headers: API_KEY_HEADER })
    expect(getRes.status()).toBe(404)
  })

  test('DELETE rejects deleting default project', async ({ request }) => {
    const listRes = await request.get('/api/projects?includeArchived=1', { headers: API_KEY_HEADER })
    const listBody = await listRes.json()
    const general = listBody.projects.find((p: any) => p.slug === 'general')
    expect(general).toBeDefined()

    const res = await request.delete(`/api/projects/${general.id}?mode=delete`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(400)
  })

  // ── Full lifecycle ───────────────────────────

  test('full lifecycle: create → read → update → archive → reactivate → delete', async ({ request }) => {
    // Create with enhanced fields
    const { id, res: createRes } = await createTestProject(request, {
      description: 'Lifecycle test project',
      github_repo: 'lifecycle/test',
      color: '#f59e0b',
    })
    expect(createRes.status()).toBe(201)

    // Read single
    const readRes = await request.get(`/api/projects/${id}`, { headers: API_KEY_HEADER })
    expect(readRes.status()).toBe(200)
    const readBody = await readRes.json()
    expect(readBody.project.description).toBe('Lifecycle test project')
    expect(readBody.project.github_repo).toBe('lifecycle/test')
    expect(readBody.project.color).toBe('#f59e0b')

    // Update
    const updateRes = await request.patch(`/api/projects/${id}`, {
      headers: API_KEY_HEADER,
      data: { name: 'Updated Lifecycle', github_repo: 'updated/repo', deadline: 1893456000 },
    })
    expect(updateRes.status()).toBe(200)
    const updateBody = await updateRes.json()
    expect(updateBody.project.name).toBe('Updated Lifecycle')
    expect(updateBody.project.github_repo).toBe('updated/repo')
    expect(updateBody.project.deadline).toBe(1893456000)

    // Archive
    const archiveRes = await request.patch(`/api/projects/${id}`, {
      headers: API_KEY_HEADER,
      data: { status: 'archived' },
    })
    expect(archiveRes.status()).toBe(200)
    expect((await archiveRes.json()).project.status).toBe('archived')

    // Reactivate
    const activateRes = await request.patch(`/api/projects/${id}`, {
      headers: API_KEY_HEADER,
      data: { status: 'active' },
    })
    expect(activateRes.status()).toBe(200)
    expect((await activateRes.json()).project.status).toBe('active')

    // Delete permanently
    const deleteRes = await request.delete(`/api/projects/${id}?mode=delete`, { headers: API_KEY_HEADER })
    expect(deleteRes.status()).toBe(200)

    // Confirm gone
    const goneRes = await request.get(`/api/projects/${id}`, { headers: API_KEY_HEADER })
    expect(goneRes.status()).toBe(404)
  })

  // ── Task count ───────────────────────────

  test('project task_count reflects actual tasks', async ({ request }) => {
    const { id } = await createTestProject(request, { ticket_prefix: 'TCNT' })
    cleanup.push(id)

    // Create a task in this project
    const taskRes = await request.post('/api/tasks', {
      headers: API_KEY_HEADER,
      data: { title: `task-count-test-${Date.now()}`, project_id: id },
    })
    expect(taskRes.status()).toBe(201)
    const taskBody = await taskRes.json()
    const taskId = taskBody.task.id

    // Check project task_count
    const getRes = await request.get(`/api/projects/${id}`, { headers: API_KEY_HEADER })
    const getBody = await getRes.json()
    expect(getBody.project.task_count).toBeGreaterThanOrEqual(1)

    // Cleanup task
    await request.delete(`/api/tasks/${taskId}`, { headers: API_KEY_HEADER })
  })
})
