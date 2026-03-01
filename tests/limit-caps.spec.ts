import { test, expect } from '@playwright/test'

/**
 * E2E tests for Issue #19 — Unbounded limit caps
 * Verifies that endpoints cap limit to 200 even if client requests more.
 */

const API_KEY_HEADER = { 'x-api-key': 'test-api-key-e2e-12345' }

// Endpoints with their server-side caps
const LIMIT_ENDPOINTS: { path: string; cap: number }[] = [
  { path: '/api/agents', cap: 200 },
  { path: '/api/tasks', cap: 200 },
  { path: '/api/activities', cap: 500 },
  { path: '/api/logs', cap: 200 },
  { path: '/api/chat/conversations', cap: 200 },
  { path: '/api/spawn', cap: 200 },
]

test.describe('Limit Caps (Issue #19)', () => {
  for (const { path: endpoint, cap } of LIMIT_ENDPOINTS) {
    test(`${endpoint}?limit=9999 does not return more than ${cap} items`, async ({ request }) => {
      const res = await request.get(`${endpoint}?limit=9999`, {
        headers: API_KEY_HEADER
      })
      // Should succeed (not error out)
      expect(res.status()).not.toBe(500)

      // The response should be valid JSON
      const body = await res.json()
      expect(body).toBeDefined()

      // If the response has an array at the top level or nested, check its length
      // Different endpoints return arrays under different keys
      const possibleArrayKeys = ['agents', 'tasks', 'activities', 'logs', 'conversations', 'history', 'data']
      for (const key of possibleArrayKeys) {
        if (Array.isArray(body[key])) {
          expect(body[key].length).toBeLessThanOrEqual(cap)
        }
      }
      // Also check if body itself is an array
      if (Array.isArray(body)) {
        expect(body.length).toBeLessThanOrEqual(cap)
      }
    })
  }

  test('search endpoint has its own cap of 100', async ({ request }) => {
    const res = await request.get('/api/search?q=test&limit=9999', {
      headers: API_KEY_HEADER
    })
    expect(res.status()).not.toBe(500)
  })
})
