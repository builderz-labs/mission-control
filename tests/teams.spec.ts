import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('Teams CRUD + Members', () => {
  let teamId: number
  let agentA: { id: number; name: string }
  let agentB: { id: number; name: string }
  const teamName = `e2e-team-${Date.now()}`

  test.beforeAll(async ({ request }) => {
    const a = await createTestAgent(request, { role: 'worker' })
    const b = await createTestAgent(request, { role: 'tester' })
    agentA = { id: a.id, name: a.body.agent.name }
    agentB = { id: b.id, name: b.body.agent.name }
  })

  test.afterAll(async ({ request }) => {
    if (teamId) {
      await request.delete('/api/teams', { headers: API_KEY_HEADER, data: { id: teamId } })
    }
    if (agentA?.id) await deleteTestAgent(request, agentA.id)
    if (agentB?.id) await deleteTestAgent(request, agentB.id)
  })

  // ── Create ──

  test('POST /api/teams creates a team', async ({ request }) => {
    const res = await request.post('/api/teams', {
      headers: API_KEY_HEADER,
      data: { name: teamName, description: 'E2E test team' },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.team).toBeDefined()
    expect(body.team.name).toBe(teamName)
    expect(body.team.description).toBe('E2E test team')
    teamId = body.team.id
  })

  test('POST /api/teams rejects duplicate name', async ({ request }) => {
    const res = await request.post('/api/teams', {
      headers: API_KEY_HEADER,
      data: { name: teamName },
    })
    expect(res.status()).toBe(409)
  })

  test('POST /api/teams rejects empty name', async ({ request }) => {
    const res = await request.post('/api/teams', {
      headers: API_KEY_HEADER,
      data: { name: '' },
    })
    expect(res.status()).toBe(400)
  })

  // ── List ──

  test('GET /api/teams lists teams', async ({ request }) => {
    const res = await request.get('/api/teams', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.teams).toBeDefined()
    const found = body.teams.find((t: { id: number }) => t.id === teamId)
    expect(found).toBeDefined()
    expect(found.name).toBe(teamName)
    expect(found.member_count).toBe(0)
  })

  // ── Members ──

  test('POST /api/teams/:id/members adds agent to team', async ({ request }) => {
    const res = await request.post(`/api/teams/${teamId}/members`, {
      headers: API_KEY_HEADER,
      data: { agent_id: agentA.id },
    })
    expect(res.status()).toBe(201)
  })

  test('POST /api/teams/:id/members adds second agent', async ({ request }) => {
    const res = await request.post(`/api/teams/${teamId}/members`, {
      headers: API_KEY_HEADER,
      data: { agent_id: agentB.id },
    })
    expect(res.status()).toBe(201)
  })

  test('POST /api/teams/:id/members rejects duplicate', async ({ request }) => {
    const res = await request.post(`/api/teams/${teamId}/members`, {
      headers: API_KEY_HEADER,
      data: { agent_id: agentA.id },
    })
    expect(res.status()).toBe(409)
  })

  test('GET /api/teams/:id/members lists members', async ({ request }) => {
    const res = await request.get(`/api/teams/${teamId}/members`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.members).toHaveLength(2)
    const names = body.members.map((m: { name: string }) => m.name)
    expect(names).toContain(agentA.name)
    expect(names).toContain(agentB.name)
  })

  test('GET /api/teams shows updated member_count', async ({ request }) => {
    const res = await request.get('/api/teams', { headers: API_KEY_HEADER })
    const body = await res.json()
    const found = body.teams.find((t: { id: number }) => t.id === teamId)
    expect(found.member_count).toBe(2)
  })

  // ── Remove member ──

  test('DELETE /api/teams/:id/members removes agent', async ({ request }) => {
    const res = await request.delete(`/api/teams/${teamId}/members`, {
      headers: API_KEY_HEADER,
      data: { agent_id: agentB.id },
    })
    expect(res.status()).toBe(200)
  })

  test('GET /api/teams/:id/members after removal shows 1', async ({ request }) => {
    const res = await request.get(`/api/teams/${teamId}/members`, { headers: API_KEY_HEADER })
    const body = await res.json()
    expect(body.members).toHaveLength(1)
    expect(body.members[0].name).toBe(agentA.name)
  })

  // ── Update ──

  test('PUT /api/teams updates team name', async ({ request }) => {
    const newName = `${teamName}-updated`
    const res = await request.put('/api/teams', {
      headers: API_KEY_HEADER,
      data: { id: teamId, name: newName, description: 'Updated' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.team.name).toBe(newName)
    expect(body.team.description).toBe('Updated')
  })

  // ── Delete ──

  test('DELETE /api/teams deletes team (cascades members)', async ({ request }) => {
    const res = await request.delete('/api/teams', {
      headers: API_KEY_HEADER,
      data: { id: teamId },
    })
    expect(res.status()).toBe(200)

    // Verify team gone
    const listRes = await request.get('/api/teams', { headers: API_KEY_HEADER })
    const body = await listRes.json()
    const found = body.teams.find((t: { id: number }) => t.id === teamId)
    expect(found).toBeUndefined()

    teamId = 0 // prevent afterAll double-delete
  })
})
