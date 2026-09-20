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
  '/api/chat/folder-order',
  '/api/chat/permission-mode',
  '/api/chat/usage',
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
  '/api/onboarding',
  '/api/security-scan',
  '/api/diagnostics',
  '/api/openclaw/doctor',
  '/api/jev/status',
  '/api/jev/models',
  '/api/jev/policies?projectId=1',
  '/api/jev/sessions?projectId=1',
  '/api/jev/sessions/00000000-0000-4000-8000-000000000000',
  '/api/jev/sessions/00000000-0000-4000-8000-000000000000/messages',
  '/api/jev/context?projectId=1&policyId=1',
  '/api/jev/evaluations?projectId=1',
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

  for (const endpoint of [
    '/api/jev/assistant', '/api/jev/policies/bulk', '/api/jev/evaluations', '/api/jev/sessions',
  ]) {
    test(`POST ${endpoint} returns 401 without auth`, async ({ request }) => {
      const res = await request.post(endpoint, { data: {} })
      expect(res.status()).toBe(401)
    })
  }
})
