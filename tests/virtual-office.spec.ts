import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Virtual Office Chat', () => {
  // ── POST /api/virtual-office/chat ─────────────────

  test('POST creates a chat message with agent and message', async ({ request }) => {
    const res = await request.post('/api/virtual-office/chat', {
      headers: API_KEY_HEADER,
      data: {
        agent: `e2e-agent-${Date.now()}`,
        message: 'Hello from E2E test',
        type: 'text',
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.message).toBeDefined()
    expect(body.message.agent).toContain('e2e-agent-')
    expect(body.message.message).toBe('Hello from E2E test')
    expect(body.message.type).toBe('text')
    expect(body.message.timestamp).toBeDefined()
    expect(body.message.id).toBeDefined()
  })

  test('POST defaults type to text when not provided', async ({ request }) => {
    const res = await request.post('/api/virtual-office/chat', {
      headers: API_KEY_HEADER,
      data: {
        agent: `e2e-agent-${Date.now()}`,
        message: 'Default type test',
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.message.type).toBe('text')
  })

  test('POST rejects missing agent field', async ({ request }) => {
    const res = await request.post('/api/virtual-office/chat', {
      headers: API_KEY_HEADER,
      data: { message: 'No agent provided' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  test('POST rejects missing message field', async ({ request }) => {
    const res = await request.post('/api/virtual-office/chat', {
      headers: API_KEY_HEADER,
      data: { agent: 'test-agent' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  // ── GET /api/virtual-office/chat ──────────────────

  test('GET returns chat history', async ({ request }) => {
    // Post a message first so there is at least one
    await request.post('/api/virtual-office/chat', {
      headers: API_KEY_HEADER,
      data: {
        agent: `e2e-reader-${Date.now()}`,
        message: 'Seeded for GET test',
      },
    })

    const res = await request.get('/api/virtual-office/chat', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.chatHistory).toBeDefined()
    expect(Array.isArray(body.chatHistory)).toBe(true)
  })
})
