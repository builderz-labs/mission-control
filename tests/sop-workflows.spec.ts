import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, deleteTestAgent } from './helpers'

test.describe('SOP Workflows API', () => {
  const agentCleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of agentCleanup) {
      await deleteTestAgent(request, id).catch(() => {})
    }
    agentCleanup.length = 0
  })

  // ── POST /api/workflows/sop/start ─────────────

  test('POST /workflows/sop/start rejects missing templateName', async ({ request }) => {
    const { id: agentId } = await createTestAgent(request)
    agentCleanup.push(agentId)

    const res = await request.post('/api/workflows/sop/start', {
      headers: API_KEY_HEADER,
      data: {
        userInput: 'do something',
        agentId,
      },
    })

    expect(res.status()).toBe(400)
  })

  test('POST /workflows/sop/start rejects missing userInput', async ({ request }) => {
    const { id: agentId } = await createTestAgent(request)
    agentCleanup.push(agentId)

    const res = await request.post('/api/workflows/sop/start', {
      headers: API_KEY_HEADER,
      data: {
        templateName: 'some-template',
        agentId,
      },
    })

    expect(res.status()).toBe(400)
  })

  test('POST /workflows/sop/start rejects missing agentId', async ({ request }) => {
    const res = await request.post('/api/workflows/sop/start', {
      headers: API_KEY_HEADER,
      data: {
        templateName: 'some-template',
        userInput: 'do something',
      },
    })

    expect(res.status()).toBe(400)
  })

  test('POST /workflows/sop/start rejects unknown template name', async ({ request }) => {
    const { id: agentId } = await createTestAgent(request)
    agentCleanup.push(agentId)

    const res = await request.post('/api/workflows/sop/start', {
      headers: API_KEY_HEADER,
      data: {
        templateName: 'nonexistent-template-xyz',
        userInput: 'do something',
        agentId,
      },
    })

    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Unknown template')
  })

  test('POST /workflows/sop/start returns 401 without auth', async ({ request }) => {
    const res = await request.post('/api/workflows/sop/start', {
      data: {
        templateName: 'test',
        userInput: 'test',
        agentId: 1,
      },
    })

    expect(res.status()).toBe(401)
  })

  // ── GET /api/workflows/sop/[id] ───────────────

  test('GET /workflows/sop/:id returns 404 for non-existent workflow run', async ({ request }) => {
    const res = await request.get('/api/workflows/sop/nonexistent-run-id-999', {
      headers: API_KEY_HEADER,
    })

    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('not found')
  })

  test('GET /workflows/sop/:id returns 401 without auth', async ({ request }) => {
    const res = await request.get('/api/workflows/sop/some-run-id')
    expect(res.status()).toBe(401)
  })
})
