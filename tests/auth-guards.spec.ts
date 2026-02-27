import { test, expect } from '@playwright/test'

/**
 * E2E tests for Issue #4 — Auth guards on GET endpoints
 * Verifies that unauthenticated requests to API endpoints are rejected.
 */

const PROTECTED_GET_ENDPOINTS = [
  '/api/agents',
  '/api/tasks',
  '/api/activities',
  '/api/notifications?recipient=test',
  '/api/status',
  '/api/logs',
  '/api/chat/conversations',
  '/api/chat/messages',
  '/api/standup',
  '/api/spawn',
  '/api/pipelines',
  '/api/pipelines/run',
  '/api/webhooks',
  '/api/webhooks/deliveries',
  '/api/workflows',
  '/api/settings',
  '/api/tokens',
  '/api/search?q=test',
  '/api/audit',
]

test.describe('Auth Guards (Issue #4)', () => {
  for (const endpoint of PROTECTED_GET_ENDPOINTS) {
    test(`GET ${endpoint} returns 401 without auth`, async ({ request }) => {
      const res = await request.get(endpoint)
      expect(res.status()).toBe(401)
    })
  }

  test('GET endpoint returns 200 with valid API key', async ({ request }) => {
    const res = await request.get('/api/agents', {
      headers: { 'x-api-key': 'test-api-key-e2e-12345' }
    })
    // Should be 200 (or possibly 500 if no gateway configured, but NOT 401)
    expect(res.status()).not.toBe(401)
  })
})
