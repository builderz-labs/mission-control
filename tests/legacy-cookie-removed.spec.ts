import { test, expect } from '@playwright/test'

/**
 * E2E tests for Issue #7 — Legacy cookie auth removal
 * Verifies that the old mission-control-auth cookie no longer authenticates.
 */

test.describe('Legacy Cookie Auth Removed (Issue #7)', () => {
  test('legacy cookie does not authenticate API requests', async ({ request }) => {
    const res = await request.get('/api/agents', {
      headers: {
        'cookie': 'mission-control-auth=test-legacy-secret'
      }
    })
    expect(res.status()).toBe(401)
  })

  test('legacy cookie does not authenticate page requests', async ({ page }) => {
    // Set the legacy cookie
    await page.context().addCookies([{
      name: 'mission-control-auth',
      value: 'test-legacy-secret',
      domain: '127.0.0.1',
      path: '/',
    }])

    // Try to access the main page — should redirect to login
    const response = await page.goto('/')
    const url = page.url()
    expect(url).toContain('/login')
  })
})
