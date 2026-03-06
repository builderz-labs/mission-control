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

  test('POST /api/chat/messages ignores client-supplied from and uses authenticated actor', async ({ request }) => {
    const res = await request.post('/api/chat/messages', {
      headers: API_KEY_HEADER,
      data: {
        from: 'spoofed-user',
        content: 'identity hardening check',
        conversation_id: `identity-check-${Date.now()}`,
      },
    })

    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.message.from_agent).toBe('API Access')
    expect(body.message.from_agent).not.toBe('spoofed-user')
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
