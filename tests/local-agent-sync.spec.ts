import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Local Agent Sync', () => {

  // ── POST /api/agents/sync?source=local ────────

  test('POST local sync returns a result', async ({ request }) => {
    const res = await request.post('/api/agents/sync?source=local', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('ok')
    expect(body).toHaveProperty('message')
    expect(typeof body.message).toBe('string')
  })

  test('POST gateway sync still works', async ({ request }) => {
    const res = await request.post('/api/agents/sync', {
      headers: API_KEY_HEADER,
    })
    // With Hermes/gateway config path: 200 with synced counts (or empty when no config file).
    // Must not return 500 with ENOENT for /nonexistent/.openclaw/openclaw.json.
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('synced')
    expect(body).not.toHaveProperty('error')
  })

  // ── GET /api/agents (source field) ────────────

  test('agents list includes source field after sync', async ({ request }) => {
    // Trigger local sync first
    await request.post('/api/agents/sync?source=local', {
      headers: API_KEY_HEADER,
    })

    const res = await request.get('/api/agents', { headers: API_KEY_HEADER })
    expect(res.status()).toBe(200)
    const body = await res.json()
    const agents = body.agents || []
    // All agents should have a source (default 'manual' from migration 034)
    for (const agent of agents) {
      // source may be null for pre-migration agents, or 'manual'/'local'/'gateway'
      expect(typeof agent.source === 'string' || agent.source === null).toBe(true)
    }
  })
})
