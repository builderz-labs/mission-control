import { test, expect } from '@playwright/test'

/**
 * E2E tests for mutationLimiter (60 req/min) on mutation endpoints.
 * Verifies that burst traffic from the same IP triggers 429 responses.
 */

test.describe('Mutation Rate Limiter', () => {
  test('POST /api/tasks returns 429 after burst from same IP', async ({ request }) => {
    // Unique IP to avoid poisoning other test suites running concurrently
    const headers = {
      'x-real-ip': '10.77.77.77',
      'x-api-key': 'test-api-key-e2e-12345',
    }
    const results: number[] = []

    // Send 65 rapid requests — limit is 60/min, so the tail should be 429
    for (let i = 0; i < 65; i++) {
      const res = await request.post('/api/tasks', {
        data: { title: `burst-test-${i}`, workspaceId: 1, assignedTo: 'test-agent' },
        headers,
      })
      results.push(res.status())
    }

    // At least one response after the limit must be 429
    expect(results.some(s => s === 429)).toBe(true)
  })

  test('PATCH /api/tasks/99999 returns 429 after burst from same IP', async ({ request }) => {
    // Different unique IP so this test is independent of the POST test above
    const headers = {
      'x-real-ip': '10.77.77.78',
      'x-api-key': 'test-api-key-e2e-12345',
    }
    const results: number[] = []

    for (let i = 0; i < 65; i++) {
      const res = await request.patch('/api/tasks/99999', {
        data: { title: `patch-burst-${i}` },
        headers,
      })
      results.push(res.status())
    }

    expect(results.some(s => s === 429)).toBe(true)
  })

  test('POST /api/memory returns 429 after burst from same IP', async ({ request }) => {
    const headers = {
      'x-real-ip': '10.77.77.79',
      'x-api-key': 'test-api-key-e2e-12345',
    }
    const results: number[] = []

    for (let i = 0; i < 65; i++) {
      const res = await request.post('/api/memory', {
        data: { key: `burst-key-${i}`, value: 'test', agentId: 'test-agent' },
        headers,
      })
      results.push(res.status())
    }

    expect(results.some(s => s === 429)).toBe(true)
  })

  test('mutation endpoint is not rate-limited for a fresh IP', async ({ request }) => {
    // Fresh IP with a single request must never receive 429
    const res = await request.post('/api/tasks', {
      data: { title: 'single-request-test', workspaceId: 1, assignedTo: 'test-agent' },
      headers: {
        'x-real-ip': '10.66.55.44',
        'x-api-key': 'test-api-key-e2e-12345',
      },
    })

    expect(res.status()).not.toBe(429)
  })
})
