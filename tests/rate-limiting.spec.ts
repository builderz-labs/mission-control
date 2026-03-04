import { test, expect } from '@playwright/test'

/**
 * E2E tests for Issue #8 — Login rate limiting
 * Verifies that login endpoint rate-limits after 5 failed attempts.
 */

test.describe('Login Rate Limiting (Issue #8)', () => {
  const TEST_USER = process.env.AUTH_USER || 'testadmin'
  const TEST_PASS = process.env.AUTH_PASS || 'testpass1234!'

  test('blocks login after 5 rapid failed attempts', async ({ request }) => {
    const results: number[] = []

    // Send 7 rapid login attempts with wrong password
    for (let i = 0; i < 7; i++) {
      const res = await request.post('/api/auth/login', {
        data: { username: TEST_USER, password: 'wrongpassword' },
        headers: { 'x-real-ip': '10.99.99.99' }
      })
      results.push(res.status())
    }

    // First 5 should be 401 (wrong password), then 429 (rate limited)
    const rateLimited = results.filter(s => s === 429)
    expect(rateLimited.length).toBeGreaterThanOrEqual(1)
  })

  test('successful login is not blocked for fresh IP', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { username: TEST_USER, password: TEST_PASS },
      headers: { 'x-real-ip': '10.88.88.88' }
    })
    // Should succeed (200) or at least not be rate limited
    expect(res.status()).not.toBe(429)
  })
})
