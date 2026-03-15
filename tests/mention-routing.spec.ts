import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('Mention Resolution + Autocomplete', () => {
  let agentId: number
  let agentName: string

  test.beforeAll(async ({ request }) => {
    const a = await createTestAgent(request, { role: 'worker' })
    agentId = a.id
    agentName = a.body.agent.name
  })

  test.afterAll(async ({ request }) => {
    if (agentId) await deleteTestAgent(request, agentId)
  })

  // ── Mention Autocomplete API ──

  test('GET /api/mentions returns agent targets', async ({ request }) => {
    const res = await request.get('/api/mentions', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.mentions).toBeDefined()
    expect(Array.isArray(body.mentions)).toBe(true)
    expect(body.total).toBeGreaterThan(0)
  })

  test('GET /api/mentions?q= filters by query', async ({ request }) => {
    const res = await request.get(`/api/mentions?q=${encodeURIComponent(agentName.slice(0, 8))}`, {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    const found = body.mentions.find((m: { handle: string }) =>
      m.handle.includes(agentName.toLowerCase().slice(0, 8))
    )
    expect(found).toBeDefined()
    expect(found.type).toBe('agent')
  })

  test('GET /api/mentions includes @all special target', async ({ request }) => {
    const res = await request.get('/api/mentions', { headers: API_KEY_HEADER })
    const body = await res.json()
    const all = body.mentions.find((m: { handle: string }) => m.handle === 'all')
    expect(all).toBeDefined()
    expect(all.type).toBe('special')
    expect(all.display).toBe('All Agents')
  })

  test('GET /api/mentions includes @human special target', async ({ request }) => {
    const res = await request.get('/api/mentions', { headers: API_KEY_HEADER })
    const body = await res.json()
    const human = body.mentions.find((m: { handle: string }) => m.handle === 'human')
    expect(human).toBeDefined()
    expect(human.type).toBe('special')
    expect(human.display).toBe('Human Operator')
  })

  test('GET /api/mentions?type=agent filters by type', async ({ request }) => {
    const res = await request.get('/api/mentions?type=agent', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    for (const m of body.mentions) {
      expect(m.type).toBe('agent')
    }
  })

  test('GET /api/mentions?limit=2 respects limit', async ({ request }) => {
    const res = await request.get('/api/mentions?limit=2', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.mentions.length).toBeLessThanOrEqual(2)
  })

  // ── Team Mention Resolution ──

  test('GET /api/mentions includes team targets after team creation', async ({ request }) => {
    // Create a team with our agent
    const teamName = `e2e-mention-team-${Date.now()}`
    const createRes = await request.post('/api/teams', {
      headers: API_KEY_HEADER,
      data: { name: teamName },
    })
    expect(createRes.status()).toBe(201)
    const teamBody = await createRes.json()
    const teamId = teamBody.team.id

    // Add agent
    await request.post(`/api/teams/${teamId}/members`, {
      headers: API_KEY_HEADER,
      data: { agent_id: agentId },
    })

    // Query mentions for team
    const res = await request.get(`/api/mentions?type=team`, { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    const teamMention = body.mentions.find((m: { handle: string }) =>
      m.handle.includes('team:')
    )
    expect(teamMention).toBeDefined()
    expect(teamMention.type).toBe('team')
    expect(teamMention.memberAgents).toBeDefined()
    expect(Array.isArray(teamMention.memberAgents)).toBe(true)

    // Cleanup
    await request.delete('/api/teams', {
      headers: API_KEY_HEADER,
      data: { id: teamId },
    })
  })

  // ── Chat Message with Mentions ──

  test('POST /api/chat/messages stores message with @mention content', async ({ request }) => {
    const convId = `e2e-mention-conv-${Date.now()}`
    const content = `Hey @${agentName.toLowerCase()} please check this`

    const res = await request.post('/api/chat/messages', {
      headers: API_KEY_HEADER,
      data: {
        content,
        conversation_id: convId,
        to: agentName,
        message_type: 'text',
      },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.message).toBeDefined()
    expect(body.message.content).toBe(content)
    expect(body.message.to_agent).toBe(agentName)

    // Verify message retrievable
    const getRes = await request.get(
      `/api/chat/messages?conversation_id=${encodeURIComponent(convId)}`,
      { headers: API_KEY_HEADER }
    )
    expect(getRes.status()).toBe(200)
    const getBody = await getRes.json()
    expect(getBody.messages.length).toBeGreaterThanOrEqual(1)
    expect(getBody.messages[0].content).toContain(`@${agentName.toLowerCase()}`)
  })

  test('POST /api/chat/messages with unknown @handle is still stored', async ({ request }) => {
    const convId = `e2e-mention-unknown-${Date.now()}`
    const res = await request.post('/api/chat/messages', {
      headers: API_KEY_HEADER,
      data: {
        content: 'Hey @nonexistent_agent_xyz do something',
        conversation_id: convId,
        message_type: 'text',
      },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.message.content).toContain('@nonexistent_agent_xyz')
  })
})
