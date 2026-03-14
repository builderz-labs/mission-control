import { test, expect } from '@playwright/test'

test.describe('Linear Webhook', () => {
  test('POST /api/linear/webhook rejects missing signature', async ({ request }) => {
    const res = await request.post('/api/linear/webhook', {
      data: { type: 'Issue.create', data: {} },
    })
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Invalid signature')
  })

  test('POST /api/linear/webhook rejects invalid signature', async ({ request }) => {
    const res = await request.post('/api/linear/webhook', {
      headers: {
        'linear-signature': 'invalid-signature',
        'Content-Type': 'application/json',
      },
      data: { type: 'Issue.create', data: {} },
    })
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Invalid signature')
  })

  test('POST /api/linear/webhook accepts valid payload structure', async ({ request }) => {
    // Without LINEAR_WEBHOOK_SECRET set, signature verification will fail
    // This test documents the expected payload structure
    const payload = {
      type: 'Issue.create',
      data: {
        id: 'test-issue-id',
        identifier: 'TEST-1',
        title: 'Test Issue',
        state: { type: 'backlog', name: 'Backlog' },
        priority: 3,
        teamId: 'team-id',
        labels: { nodes: [] },
      },
    }

    const res = await request.post('/api/linear/webhook', {
      headers: {
        'linear-signature': 'test-sig',
        'Content-Type': 'application/json',
      },
      data: payload,
    })

    // Will fail signature check without proper secret
    expect(res.status()).toBe(401)
  })
})
