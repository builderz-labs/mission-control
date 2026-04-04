import { test, expect } from '@playwright/test'

/**
 * E2E tests for requireRole auth guard.
 * Verifies that endpoints protected by requireRole reject unauthenticated requests with 401.
 *
 * Endpoints chosen because each handler calls requireRole() before any business logic:
 *  - GET  /api/settings          → requireRole(request, 'admin')
 *  - PUT  /api/settings          → requireRole(request, 'admin')
 *  - GET  /api/gateway-config    → requireRole(request, 'admin')
 *  - PUT  /api/gateway-config    → requireRole(request, 'admin')
 *  - GET  /api/claude-tasks      → requireRole(request, 'viewer')
 */

interface Endpoint {
  method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: Record<string, unknown>
}

const ENDPOINTS_WITH_REQUIRE_ROLE: Endpoint[] = [
  { method: 'GET',  path: '/api/settings' },
  { method: 'PUT',  path: '/api/settings',       body: { key: 'test', value: 'test' } },
  { method: 'GET',  path: '/api/gateway-config' },
  { method: 'PUT',  path: '/api/gateway-config', body: { provider: 'test' } },
  { method: 'GET',  path: '/api/claude-tasks' },
]

test.describe('requireRole Auth Guard', () => {
  for (const ep of ENDPOINTS_WITH_REQUIRE_ROLE) {
    test(`${ep.method} ${ep.path} returns 401 without auth`, async ({ request }) => {
      // No credentials at all — simulates a completely unauthenticated caller
      let res
      switch (ep.method) {
        case 'GET':
          res = await request.get(ep.path)
          break
        case 'PUT':
          res = await request.put(ep.path, { data: ep.body ?? {} })
          break
        case 'POST':
          res = await request.post(ep.path, { data: ep.body ?? {} })
          break
        case 'PATCH':
          res = await request.patch(ep.path, { data: ep.body ?? {} })
          break
        case 'DELETE':
          res = await request.delete(ep.path)
          break
      }

      expect(res.status()).toBe(401)
    })
  }

  test('requireRole endpoint accepts request with valid API key', async ({ request }) => {
    // A valid API key satisfies the auth check; the actual response code varies
    // by business logic (could be 200, 400, 404, 500) but must NOT be 401.
    const res = await request.get('/api/settings', {
      headers: { 'x-api-key': 'test-api-key-e2e-12345' },
    })

    expect(res.status()).not.toBe(401)
  })
})
