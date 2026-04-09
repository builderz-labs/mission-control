import { test, expect } from '@playwright/test'
import { API_KEY_HEADER, createTestAgent, createTestTask, deleteTestAgent, deleteTestTask } from './helpers'

test.describe('Actor Identity Hardening', () => {
  const taskCleanup: number[] = []
  const agentCleanup: number[] = []

  test.afterEach(async ({ request }) => {
    while (taskCleanup.length > 0) {
      const id = taskCleanup.pop()!
      await deleteTestTask(request, id)
    }
    while (agentCleanup.length > 0) {
      const id = agentCleanup.pop()!
      await deleteTestAgent(request, id)
    }
  })

  test('POST /api/chat/messages preserves client-supplied from for agent identity; falls back to auth actor when omitted', async ({ request }) => {
    // WHY: Agent-to-agent messaging must preserve the sender's agent identity (e.g.
    // 'coordinator', 'e2e-operator-123'). The API auth check still enforces that only
    // authorised operators can POST; the `from` field is not a security boundary here.
    const resWithFrom = await request.post('/api/chat/messages', {
      headers: API_KEY_HEADER,
      data: {
        from: 'some-agent',
        content: 'identity hardening check with explicit from',
        conversation_id: `identity-check-${Date.now()}`,
      },
    })
    expect(resWithFrom.status()).toBe(201)
    const bodyWithFrom = await resWithFrom.json()
    expect(bodyWithFrom.message.from_agent).toBe('some-agent')

    // When `from` is omitted the server falls back to the authenticated user's identity.
    const resNoFrom = await request.post('/api/chat/messages', {
      headers: API_KEY_HEADER,
      data: {
        content: 'identity hardening check without from',
        conversation_id: `identity-check-no-from-${Date.now()}`,
      },
    })
    expect(resNoFrom.status()).toBe(201)
    const bodyNoFrom = await resNoFrom.json()
    expect(bodyNoFrom.message.from_agent).toBe('API Access')
  })

  test('POST /api/tasks/[id]/broadcast ignores client-supplied author', async ({ request }) => {
    const { id: taskId } = await createTestTask(request)
    taskCleanup.push(taskId)

    const { id: agentId, name: agentName } = await createTestAgent(request)
    agentCleanup.push(agentId)

    const commentRes = await request.post(`/api/tasks/${taskId}/comments`, {
      headers: API_KEY_HEADER,
      data: { content: `Mentioning @${agentName} for subscription` },
    })
    expect(commentRes.status()).toBe(201)

    const broadcastRes = await request.post(`/api/tasks/${taskId}/broadcast`, {
      headers: API_KEY_HEADER,
      data: {
        author: agentName,
        message: 'hardening broadcast test',
      },
    })

    expect(broadcastRes.status()).toBe(200)
    const body = await broadcastRes.json()
    expect(body.sent + body.skipped).toBe(1)
    expect(body.skipped).toBe(1)
  })
})
