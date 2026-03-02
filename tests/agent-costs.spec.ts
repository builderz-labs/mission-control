import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Agent Costs API', () => {
  test('GET action=stats includes agents field', async ({ request }) => {
    const res = await request.get('/api/tokens?action=stats&timeframe=all', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('summary')
    expect(body).toHaveProperty('models')
    expect(body).toHaveProperty('sessions')
    expect(body).toHaveProperty('agents')
    expect(body).toHaveProperty('timeframe')
    expect(body).toHaveProperty('recordCount')
    expect(typeof body.agents).toBe('object')
  })

  test('GET action=agent-costs returns per-agent breakdown', async ({ request }) => {
    const res = await request.get('/api/tokens?action=agent-costs&timeframe=all', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('agents')
    expect(body).toHaveProperty('timeframe')
    expect(body).toHaveProperty('recordCount')
    expect(typeof body.agents).toBe('object')

    // If there are agents, verify structure
    for (const [, agentData] of Object.entries(body.agents) as [string, any][]) {
      expect(agentData).toHaveProperty('stats')
      expect(agentData).toHaveProperty('models')
      expect(agentData).toHaveProperty('sessions')
      expect(agentData).toHaveProperty('timeline')
      expect(agentData.stats).toHaveProperty('totalTokens')
      expect(agentData.stats).toHaveProperty('totalCost')
      expect(agentData.stats).toHaveProperty('requestCount')
      expect(Array.isArray(agentData.sessions)).toBe(true)
      expect(Array.isArray(agentData.timeline)).toBe(true)
    }
  })

  test('GET action=agent-costs respects timeframe filtering', async ({ request }) => {
    // Create a token record to ensure data exists
    await request.post('/api/tokens', {
      headers: API_KEY_HEADER,
      data: {
        model: 'claude-sonnet-4',
        sessionId: 'e2e-cost-agent:chat',
        inputTokens: 100,
        outputTokens: 50,
      },
    })

    const resHour = await request.get('/api/tokens?action=agent-costs&timeframe=hour', {
      headers: API_KEY_HEADER,
    })
    expect(resHour.status()).toBe(200)
    const hourData = await resHour.json()
    expect(hourData.timeframe).toBe('hour')

    const resMonth = await request.get('/api/tokens?action=agent-costs&timeframe=month', {
      headers: API_KEY_HEADER,
    })
    expect(resMonth.status()).toBe(200)
    const monthData = await resMonth.json()
    expect(monthData.timeframe).toBe('month')
    // Month should include at least as many records as hour
    expect(monthData.recordCount).toBeGreaterThanOrEqual(hourData.recordCount)
  })

  test('POST /api/tokens records data that appears in agent-costs', async ({ request }) => {
    const agentName = `e2e-costtest-${Date.now()}`
    const postRes = await request.post('/api/tokens', {
      headers: API_KEY_HEADER,
      data: {
        model: 'claude-sonnet-4',
        sessionId: `${agentName}:chat`,
        inputTokens: 500,
        outputTokens: 200,
      },
    })
    expect(postRes.status()).toBe(200)

    const res = await request.get('/api/tokens?action=agent-costs&timeframe=hour', {
      headers: API_KEY_HEADER,
    })
    const body = await res.json()
    expect(body.agents).toHaveProperty(agentName)
    expect(body.agents[agentName].stats.totalTokens).toBe(700)
    expect(body.agents[agentName].stats.requestCount).toBe(1)
  })

  test('GET action=agent-costs requires auth', async ({ request }) => {
    const res = await request.get('/api/tokens?action=agent-costs&timeframe=all')
    expect(res.status()).toBe(401)
  })
})
