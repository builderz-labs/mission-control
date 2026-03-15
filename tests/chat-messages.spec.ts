import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Chat Messages', () => {
  // ── GET /api/chat/conversations ────────────

  test('GET /api/chat/conversations returns list shape', async ({ request }) => {
    const res = await request.get('/api/chat/conversations', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.conversations)).toBe(true)
    expect(typeof body.total).toBe('number')
    expect(typeof body.page).toBe('number')
    expect(typeof body.limit).toBe('number')
  })

  test('GET conversations respects limit', async ({ request }) => {
    const res = await request.get('/api/chat/conversations?limit=1', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.conversations.length).toBeLessThanOrEqual(1)
  })

  // ── GET /api/chat/messages ─────────────────

  test('GET /api/chat/messages returns list shape', async ({ request }) => {
    const res = await request.get('/api/chat/messages', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.messages)).toBe(true)
    expect(typeof body.total).toBe('number')
    expect(typeof body.page).toBe('number')
    expect(typeof body.limit).toBe('number')
  })

  // ── POST /api/chat/messages ────────────────

  test('POST creates a chat message', async ({ request }) => {
    const conversationId = `e2e-conv-${Date.now()}`
    const res = await request.post('/api/chat/messages', {
      headers: API_KEY_HEADER,
      data: {
        content: 'Hello from e2e test',
        conversation_id: conversationId,
      },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.message).toBeDefined()
    expect(body.message.content).toBe('Hello from e2e test')
    expect(body.message.from_agent).toBeDefined()
    expect(body.message.conversation_id).toBe(conversationId)
  })

  test('POST rejects empty content', async ({ request }) => {
    const res = await request.post('/api/chat/messages', {
      headers: API_KEY_HEADER,
      data: { content: '' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST creates message with to agent', async ({ request }) => {
    const res = await request.post('/api/chat/messages', {
      headers: API_KEY_HEADER,
      data: {
        content: 'Directed message from e2e',
        to: 'target-agent',
      },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.message).toBeDefined()
    expect(body.message.content).toBe('Directed message from e2e')
    expect(body.message.to_agent).toBe('target-agent')
  })

  // ── GET /api/chat/messages with filters ────

  test('GET messages filters by conversation_id', async ({ request }) => {
    const uniqueConv = `e2e-filter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Create a message with a unique conversation_id
    const postRes = await request.post('/api/chat/messages', {
      headers: API_KEY_HEADER,
      data: {
        content: 'Filterable message',
        conversation_id: uniqueConv,
      },
    })
    expect(postRes.status()).toBe(201)

    // Fetch messages filtered by that conversation_id
    const getRes = await request.get(
      `/api/chat/messages?conversation_id=${encodeURIComponent(uniqueConv)}`,
      { headers: API_KEY_HEADER },
    )
    expect(getRes.status()).toBe(200)
    const body = await getRes.json()
    expect(body.messages.length).toBeGreaterThanOrEqual(1)
    const match = body.messages.find(
      (m: { content: string }) => m.content === 'Filterable message',
    )
    expect(match).toBeDefined()
    expect(match.conversation_id).toBe(uniqueConv)
  })
})
