import { expect, test } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('Agent API keys', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup.splice(0)) {
      await deleteTestAgent(request, id).catch(() => {})
    }
  })

  test('supports scoped agent auth without x-agent-name and allows revoke', async ({ request }) => {
    const primary = await createTestAgent(request)
    const other = await createTestAgent(request)
    cleanup.push(primary.id, other.id)

    const createKeyRes = await request.post(`/api/agents/${primary.id}/keys`, {
      headers: API_KEY_HEADER,
      data: {
        name: 'diag-key',
        scopes: ['viewer', 'agent:self', 'agent:diagnostics'],
        expires_in_days: 1,
      },
    })
    expect(createKeyRes.status()).toBe(201)
    const createKeyBody = await createKeyRes.json()
    expect(createKeyBody.api_key).toMatch(/^mca_/) 

    const agentKeyHeader = { 'x-api-key': createKeyBody.api_key as string }

    const selfRes = await request.get(`/api/agents/${primary.id}/diagnostics?section=summary`, {
      headers: agentKeyHeader,
    })
    expect(selfRes.status()).toBe(200)

    const crossRes = await request.get(`/api/agents/${other.id}/diagnostics?section=summary`, {
      headers: agentKeyHeader,
    })
    expect(crossRes.status()).toBe(403)

    const listRes = await request.get(`/api/agents/${primary.id}/keys`, { headers: API_KEY_HEADER })
    expect(listRes.status()).toBe(200)
    const listBody = await listRes.json()
    const storedKey = listBody.keys.find((entry: any) => entry.id === createKeyBody.key.id)
    expect(storedKey).toBeDefined()
    expect(storedKey.key_prefix).toBe(createKeyBody.key.key_prefix)

    const revokeRes = await request.delete(`/api/agents/${primary.id}/keys`, {
      headers: API_KEY_HEADER,
      data: { key_id: createKeyBody.key.id },
    })
    expect(revokeRes.status()).toBe(200)

    const afterRevoke = await request.get(`/api/agents/${primary.id}/diagnostics?section=summary`, {
      headers: agentKeyHeader,
    })
    expect(afterRevoke.status()).toBe(401)
  })

  test('rejects expired agent keys', async ({ request }) => {
    const primary = await createTestAgent(request)
    cleanup.push(primary.id)

    const createKeyRes = await request.post(`/api/agents/${primary.id}/keys`, {
      headers: API_KEY_HEADER,
      data: {
        name: 'expired-key',
        scopes: ['viewer', 'agent:self'],
        expires_at: Math.floor(Date.now() / 1000) - 5,
      },
    })
    expect(createKeyRes.status()).toBe(201)

    const { api_key } = await createKeyRes.json()

    const expiredRes = await request.get(`/api/agents/${primary.id}/attribution?section=identity`, {
      headers: { 'x-api-key': api_key },
    })
    expect(expiredRes.status()).toBe(401)
  })
})
