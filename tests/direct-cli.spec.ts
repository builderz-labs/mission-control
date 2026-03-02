import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Direct CLI Integration', () => {
  const createdConnectionIds: string[] = []
  const createdAgentIds: number[] = []

  test.afterEach(async ({ request }) => {
    // Clean up connections
    for (const connId of createdConnectionIds) {
      await request.delete('/api/connect', {
        headers: API_KEY_HEADER,
        data: { connection_id: connId },
      })
    }
    createdConnectionIds.length = 0

    // Clean up auto-created agents
    for (const agentId of createdAgentIds) {
      await request.delete(`/api/agents/${agentId}`, { headers: API_KEY_HEADER })
    }
    createdAgentIds.length = 0
  })

  test('POST /api/connect creates connection and auto-creates agent', async ({ request }) => {
    const agentName = `e2e-cli-${Date.now()}`
    const res = await request.post('/api/connect', {
      headers: API_KEY_HEADER,
      data: {
        tool_name: 'claude-code',
        tool_version: '1.0.0',
        agent_name: agentName,
        agent_role: 'developer',
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(body.connection_id).toBeDefined()
    expect(body.agent_id).toBeDefined()
    expect(body.agent_name).toBe(agentName)
    expect(body.status).toBe('connected')
    expect(body.sse_url).toBe('/api/events')
    expect(body.heartbeat_url).toContain('/api/agents/')
    expect(body.token_report_url).toBe('/api/tokens')

    createdConnectionIds.push(body.connection_id)
    createdAgentIds.push(body.agent_id)

    // Verify agent was created
    const agentRes = await request.get(`/api/agents/${body.agent_id}`, {
      headers: API_KEY_HEADER,
    })
    expect(agentRes.status()).toBe(200)
    const agentBody = await agentRes.json()
    expect(agentBody.agent.name).toBe(agentName)
    expect(agentBody.agent.status).toBe('online')
  })

  test('GET /api/connect lists connections', async ({ request }) => {
    const agentName = `e2e-cli-list-${Date.now()}`
    const postRes = await request.post('/api/connect', {
      headers: API_KEY_HEADER,
      data: {
        tool_name: 'codex',
        agent_name: agentName,
      },
    })
    const postBody = await postRes.json()
    createdConnectionIds.push(postBody.connection_id)
    createdAgentIds.push(postBody.agent_id)

    const res = await request.get('/api/connect', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.connections)).toBe(true)
    const found = body.connections.find((c: any) => c.connection_id === postBody.connection_id)
    expect(found).toBeDefined()
    expect(found.agent_name).toBe(agentName)
    expect(found.tool_name).toBe('codex')
  })

  test('POST heartbeat with inline token_usage', async ({ request }) => {
    const agentName = `e2e-cli-hb-${Date.now()}`
    const postRes = await request.post('/api/connect', {
      headers: API_KEY_HEADER,
      data: {
        tool_name: 'claude-code',
        agent_name: agentName,
      },
    })
    const postBody = await postRes.json()
    createdConnectionIds.push(postBody.connection_id)
    createdAgentIds.push(postBody.agent_id)

    const hbRes = await request.post(`/api/agents/${postBody.agent_id}/heartbeat`, {
      headers: API_KEY_HEADER,
      data: {
        connection_id: postBody.connection_id,
        token_usage: {
          model: 'claude-sonnet-4',
          inputTokens: 1000,
          outputTokens: 500,
        },
      },
    })
    expect(hbRes.status()).toBe(200)
    const hbBody = await hbRes.json()
    expect(hbBody.token_recorded).toBe(true)
    expect(hbBody.agent).toBe(agentName)
  })

  test('DELETE /api/connect disconnects and sets agent offline', async ({ request }) => {
    const agentName = `e2e-cli-del-${Date.now()}`
    const postRes = await request.post('/api/connect', {
      headers: API_KEY_HEADER,
      data: {
        tool_name: 'claude-code',
        agent_name: agentName,
      },
    })
    const postBody = await postRes.json()
    createdAgentIds.push(postBody.agent_id)

    const delRes = await request.delete('/api/connect', {
      headers: API_KEY_HEADER,
      data: { connection_id: postBody.connection_id },
    })
    expect(delRes.status()).toBe(200)
    const delBody = await delRes.json()
    expect(delBody.status).toBe('disconnected')

    // Agent should be offline
    const agentRes = await request.get(`/api/agents/${postBody.agent_id}`, {
      headers: API_KEY_HEADER,
    })
    const agentBody = await agentRes.json()
    expect(agentBody.agent.status).toBe('offline')
  })

  test('POST /api/connect requires auth', async ({ request }) => {
    const res = await request.post('/api/connect', {
      data: {
        tool_name: 'claude-code',
        agent_name: 'unauthorized-agent',
      },
    })
    expect(res.status()).toBe(401)
  })
})
