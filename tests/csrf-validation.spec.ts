import { test, expect } from '@playwright/test'

/**
 * E2E tests for Issue #20 — CSRF Origin header validation
 * Verifies that mutating requests with mismatched Origin are rejected.
 */

test.describe('CSRF Origin Validation (Issue #20)', () => {
  test('POST with mismatched Origin is rejected', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { username: 'test', password: 'test' },
      headers: {
        'origin': 'https://evil.example.com',
        'host': '127.0.0.1:3005'
      }
    })
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('CSRF')
  })

  test('POST with matching Origin is allowed', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { username: 'testadmin', password: 'testpass123' },
      headers: {
        'origin': 'http://127.0.0.1:3005',
        'host': '127.0.0.1:3005'
      }
    })
    // Should not be 403 CSRF — may be 200 (success) or other status
    expect(res.status()).not.toBe(403)
  })

  test('POST without Origin header is allowed (non-browser client)', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { username: 'testadmin', password: 'testpass123' },
    })
    // No Origin = non-browser client, should be allowed through CSRF check
    expect(res.status()).not.toBe(403)
  })

  test('GET requests are not subject to CSRF check', async ({ request }) => {
    const res = await request.get('/api/agents', {
      headers: {
        'origin': 'https://evil.example.com',
        'x-api-key': 'test-api-key-e2e-12345'
      }
    })
    // GET is exempt from CSRF — should not be 403
    expect(res.status()).not.toBe(403)
  })
})
