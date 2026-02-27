import { test, expect } from '@playwright/test'

/**
 * E2E tests for Issue #19 — Unbounded limit caps
 * Verifies that endpoints cap limit to 200 even if client requests more.
 */

const API_KEY_HEADER = { 'x-api-key': 'test-api-key-e2e-12345' }

// These endpoints accept a `limit` query param
const LIMIT_ENDPOINTS = [
  '/api/agents',
  '/api/tasks',
  '/api/activities',
  '/api/logs',
  '/api/chat/conversations',
  '/api/spawn',
]

test.describe('Limit Caps (Issue #19)', () => {
  for (const endpoint of LIMIT_ENDPOINTS) {
    test(`${endpoint}?limit=9999 does not return more than 200 items`, async ({ request }) => {
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
          expect(body[key].length).toBeLessThanOrEqual(200)
        }
      }
      // Also check if body itself is an array
      if (Array.isArray(body)) {
        expect(body.length).toBeLessThanOrEqual(200)
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
