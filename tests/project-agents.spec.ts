import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestProject, deleteTestProject, createTestAgent, deleteTestAgent } from './helpers'

test.describe('Project Agent Assignments', () => {
  const projectCleanup: number[] = []
  const agentCleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of projectCleanup) {
      await deleteTestProject(request, id).catch(() => {})
    }
    for (const id of agentCleanup) {
      await deleteTestAgent(request, id).catch(() => {})
    }
    projectCleanup.length = 0
    agentCleanup.length = 0
  })

  // ── POST /api/projects/[id]/agents ──────────────

  test('POST assigns agent to project', async ({ request }) => {
    const { id: projectId } = await createTestProject(request)
    projectCleanup.push(projectId)
    const { id: agentId, name: agentName } = await createTestAgent(request)
    agentCleanup.push(agentId)

    const res = await request.post(`/api/projects/${projectId}/agents`, {
      headers: API_KEY_HEADER,
      data: { agent_name: agentName },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  test('POST assigns agent with custom role', async ({ request }) => {
    const { id: projectId } = await createTestProject(request)
    projectCleanup.push(projectId)
    const { id: agentId, name: agentName } = await createTestAgent(request)
    agentCleanup.push(agentId)

    const res = await request.post(`/api/projects/${projectId}/agents`, {
      headers: API_KEY_HEADER,
      data: { agent_name: agentName, role: 'lead' },
    })
    expect(res.status()).toBe(201)
  })

  test('POST is idempotent for same agent', async ({ request }) => {
    const { id: projectId } = await createTestProject(request)
    projectCleanup.push(projectId)
    const { id: agentId, name: agentName } = await createTestAgent(request)
    agentCleanup.push(agentId)

    // First assign
    const res1 = await request.post(`/api/projects/${projectId}/agents`, {
      headers: API_KEY_HEADER,
      data: { agent_name: agentName },
    })
    expect(res1.status()).toBe(201)

    // Second assign (should not fail due to INSERT OR IGNORE)
    const res2 = await request.post(`/api/projects/${projectId}/agents`, {
      headers: API_KEY_HEADER,
      data: { agent_name: agentName },
    })
    expect(res2.status()).toBe(201)
  })

  test('POST rejects empty agent_name', async ({ request }) => {
    const { id: projectId } = await createTestProject(request)
    projectCleanup.push(projectId)

    const res = await request.post(`/api/projects/${projectId}/agents`, {
      headers: API_KEY_HEADER,
      data: { agent_name: '' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST returns 404 for missing project', async ({ request }) => {
    const res = await request.post('/api/projects/999999/agents', {
      headers: API_KEY_HEADER,
      data: { agent_name: 'ghost-agent' },
    })
    expect(res.status()).toBe(404)
  })

  // ── GET /api/projects/[id]/agents ───────────────

  test('GET lists assigned agents', async ({ request }) => {
    const { id: projectId } = await createTestProject(request)
    projectCleanup.push(projectId)
    const { id: agentId, name: agentName } = await createTestAgent(request)
    agentCleanup.push(agentId)

    // Assign agent
    await request.post(`/api/projects/${projectId}/agents`, {
      headers: API_KEY_HEADER,
      data: { agent_name: agentName, role: 'reviewer' },
    })

    // List
    const res = await request.get(`/api/projects/${projectId}/agents`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('assignments')
    expect(Array.isArray(body.assignments)).toBe(true)

    const found = body.assignments.find((a: any) => a.agent_name === agentName)
    expect(found).toBeDefined()
    expect(found.role).toBe('reviewer')
    expect(found.project_id).toBe(projectId)
  })

  test('GET returns empty array for project with no agents', async ({ request }) => {
    const { id: projectId } = await createTestProject(request)
    projectCleanup.push(projectId)

    const res = await request.get(`/api/projects/${projectId}/agents`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.assignments).toEqual([])
  })

  test('GET returns 404 for missing project', async ({ request }) => {
    const res = await request.get('/api/projects/999999/agents', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })

  // ── DELETE /api/projects/[id]/agents ────────────

  test('DELETE unassigns agent from project', async ({ request }) => {
    const { id: projectId } = await createTestProject(request)
    projectCleanup.push(projectId)
    const { id: agentId, name: agentName } = await createTestAgent(request)
    agentCleanup.push(agentId)

    // Assign
    await request.post(`/api/projects/${projectId}/agents`, {
      headers: API_KEY_HEADER,
      data: { agent_name: agentName },
    })

    // Unassign
    const res = await request.delete(
      `/api/projects/${projectId}/agents?agent_name=${encodeURIComponent(agentName)}`,
      { headers: API_KEY_HEADER }
    )
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    // Verify gone
    const listRes = await request.get(`/api/projects/${projectId}/agents`, { headers: API_KEY_HEADER })
    const listBody = await listRes.json()
    const found = listBody.assignments.find((a: any) => a.agent_name === agentName)
    expect(found).toBeUndefined()
  })

  test('DELETE without agent_name returns 400', async ({ request }) => {
    const { id: projectId } = await createTestProject(request)
    projectCleanup.push(projectId)

    const res = await request.delete(`/api/projects/${projectId}/agents`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(400)
  })

  test('DELETE returns 404 for missing project', async ({ request }) => {
    const res = await request.delete('/api/projects/999999/agents?agent_name=x', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })

  // ── assigned_agents in project response ─────────

  test('assigned_agents appears in project list response after assignment', async ({ request }) => {
    const { id: projectId } = await createTestProject(request)
    projectCleanup.push(projectId)
    const { id: agentId, name: agentName } = await createTestAgent(request)
    agentCleanup.push(agentId)

    // Assign
    await request.post(`/api/projects/${projectId}/agents`, {
      headers: API_KEY_HEADER,
      data: { agent_name: agentName },
    })

    // Check project list
    const listRes = await request.get('/api/projects', { headers: API_KEY_HEADER })
    const listBody = await listRes.json()
    const project = listBody.projects.find((p: any) => p.id === projectId)
    expect(project).toBeDefined()
    expect(project.assigned_agents).toContain(agentName)
  })

  test('assigned_agents appears in single project response', async ({ request }) => {
    const { id: projectId } = await createTestProject(request)
    projectCleanup.push(projectId)
    const { id: agentId, name: agentName } = await createTestAgent(request)
    agentCleanup.push(agentId)

    // Assign
    await request.post(`/api/projects/${projectId}/agents`, {
      headers: API_KEY_HEADER,
      data: { agent_name: agentName },
    })

    // Check single project
    const getRes = await request.get(`/api/projects/${projectId}`, { headers: API_KEY_HEADER })
    const getBody = await getRes.json()
    expect(getBody.project.assigned_agents).toContain(agentName)
  })

  test('PATCH updates project fields and assignment membership atomically', async ({ request }) => {
    const { id: projectId } = await createTestProject(request)
    projectCleanup.push(projectId)
    const { id: existingAgentId, name: existingAgentName } = await createTestAgent(request)
    const { id: addedAgentId, name: addedAgentName } = await createTestAgent(request)
    agentCleanup.push(existingAgentId, addedAgentId)

    await request.post(`/api/projects/${projectId}/agents`, {
      headers: API_KEY_HEADER,
      data: { agent_name: existingAgentName, role: 'reviewer' },
    })

    const updateRes = await request.patch(`/api/projects/${projectId}`, {
      headers: API_KEY_HEADER,
      data: {
        description: 'Atomic update',
        assigned_agents: [existingAgentName, addedAgentName],
      },
    })
    expect(updateRes.status()).toBe(200)
    const updateBody = await updateRes.json()
    expect(updateBody.project.description).toBe('Atomic update')
    expect(updateBody.project.assigned_agents).toEqual(expect.arrayContaining([existingAgentName, addedAgentName]))

    const assignmentsRes = await request.get(`/api/projects/${projectId}/agents`, { headers: API_KEY_HEADER })
    const assignmentsBody = await assignmentsRes.json()
    expect(assignmentsBody.assignments).toHaveLength(2)
    expect(assignmentsBody.assignments.find((item: any) => item.agent_name === existingAgentName)?.role).toBe('reviewer')
    expect(assignmentsBody.assignments.find((item: any) => item.agent_name === addedAgentName)?.role).toBe('member')
  })

  test('PATCH rolls back project fields when assignment validation fails', async ({ request }) => {
    const { id: projectId } = await createTestProject(request)
    projectCleanup.push(projectId)
    const { id: agentId, name: agentName } = await createTestAgent(request)
    agentCleanup.push(agentId)

    await request.patch(`/api/projects/${projectId}`, {
      headers: API_KEY_HEADER,
      data: { description: 'Before update' },
    })
    await request.post(`/api/projects/${projectId}/agents`, {
      headers: API_KEY_HEADER,
      data: { agent_name: agentName },
    })

    const updateRes = await request.patch(`/api/projects/${projectId}`, {
      headers: API_KEY_HEADER,
      data: {
        description: 'Must not persist',
        assigned_agents: [agentName, 'missing-agent'],
      },
    })
    expect(updateRes.status()).toBe(400)

    const projectRes = await request.get(`/api/projects/${projectId}`, { headers: API_KEY_HEADER })
    const projectBody = await projectRes.json()
    expect(projectBody.project.description).toBe('Before update')
    expect(projectBody.project.assigned_agents).toEqual([agentName])
  })

  test('PATCH edits the default project without parsing the body twice', async ({ request }) => {
    const projectsRes = await request.get('/api/projects?includeArchived=1', { headers: API_KEY_HEADER })
    const projectsBody = await projectsRes.json()
    const general = projectsBody.projects.find((project: any) => project.slug === 'general')
    expect(general).toBeDefined()

    try {
      const updateRes = await request.patch(`/api/projects/${general.id}`, {
        headers: API_KEY_HEADER,
        data: { description: 'Default project edit regression check' },
      })
      expect(updateRes.status()).toBe(200)
      const updateBody = await updateRes.json()
      expect(updateBody.project.description).toBe('Default project edit regression check')
    } finally {
      await request.patch(`/api/projects/${general.id}`, {
        headers: API_KEY_HEADER,
        data: { description: general.description ?? null },
      })
    }
  })

  // ── Full lifecycle ───────────────────────────

  test('full lifecycle: assign multiple → list → unassign one → verify', async ({ request }) => {
    const { id: projectId } = await createTestProject(request)
    projectCleanup.push(projectId)
    const { id: agent1Id, name: agent1Name } = await createTestAgent(request)
    agentCleanup.push(agent1Id)
    const { id: agent2Id, name: agent2Name } = await createTestAgent(request)
    agentCleanup.push(agent2Id)

    // Assign both
    await request.post(`/api/projects/${projectId}/agents`, {
      headers: API_KEY_HEADER,
      data: { agent_name: agent1Name, role: 'developer' },
    })
    await request.post(`/api/projects/${projectId}/agents`, {
      headers: API_KEY_HEADER,
      data: { agent_name: agent2Name, role: 'reviewer' },
    })

    // List — both present
    const listRes1 = await request.get(`/api/projects/${projectId}/agents`, { headers: API_KEY_HEADER })
    const list1 = await listRes1.json()
    expect(list1.assignments.length).toBe(2)

    // Unassign first
    await request.delete(
      `/api/projects/${projectId}/agents?agent_name=${encodeURIComponent(agent1Name)}`,
      { headers: API_KEY_HEADER }
    )

    // List — only second remains
    const listRes2 = await request.get(`/api/projects/${projectId}/agents`, { headers: API_KEY_HEADER })
    const list2 = await listRes2.json()
    expect(list2.assignments.length).toBe(1)
    expect(list2.assignments[0].agent_name).toBe(agent2Name)
    expect(list2.assignments[0].role).toBe('reviewer')
  })

  // ── Cascade deletion ───────────────────────────

  test('deleting a project cascades to remove agent assignments', async ({ request }) => {
    const { id: projectId } = await createTestProject(request)
    const { id: agentId, name: agentName } = await createTestAgent(request)
    agentCleanup.push(agentId)

    // Assign
    await request.post(`/api/projects/${projectId}/agents`, {
      headers: API_KEY_HEADER,
      data: { agent_name: agentName },
    })

    // Delete project permanently
    await request.delete(`/api/projects/${projectId}?mode=delete`, { headers: API_KEY_HEADER })

    // Agent assignments should be gone (project is gone, can't query assignments)
    const res = await request.get(`/api/projects/${projectId}/agents`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(404)
  })
})
