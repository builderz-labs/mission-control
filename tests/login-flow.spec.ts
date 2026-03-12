import { test, expect } from '@playwright/test'

/**
 * E2E smoke test — Login flow and session auth
 * Verifies the basic login/session/logout lifecycle works end-to-end.
 */

test.describe('Login Flow', () => {
  const TEST_API_KEY = process.env.API_KEY || 'test-api-key-e2e-12345'
  const TEST_PASS = 'testpass1234!'
  const TEST_USER = `login-e2e-${Date.now()}`

  test.beforeAll(async ({ request }) => {
    const createRes = await request.post('/api/auth/users', {
      data: {
        username: TEST_USER,
        password: TEST_PASS,
        display_name: 'Login E2E User',
        role: 'admin',
      },
      headers: {
        'x-api-key': TEST_API_KEY,
      },
    })

    expect([201, 409]).toContain(createRes.status())
  })

  test('login page loads', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveURL(/\/login/)
  })

  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })

  test('login API returns session cookie on success', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { username: TEST_USER, password: TEST_PASS },
      headers: { 'x-forwarded-for': '10.88.88.1' }
    })
    expect(res.status()).toBe(200)

    const cookies = res.headers()['set-cookie']
    expect(cookies).toBeDefined()
    expect(cookies).toMatch(/(__Host-)?mc-session/)
  })

  test('login API rejects wrong password', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { username: TEST_USER, password: 'wrongpassword' },
      headers: { 'x-forwarded-for': '10.77.77.77' }
    })
    expect(res.status()).toBe(401)
  })

  test('session cookie grants API access', async ({ request }) => {
    // Login to get a session
    const loginRes = await request.post('/api/auth/login', {
      data: { username: TEST_USER, password: TEST_PASS },
      headers: { 'x-forwarded-for': '10.88.88.2' }
    })
    expect(loginRes.status()).toBe(200)

    // Extract session cookie from Set-Cookie header
    const setCookie = loginRes.headers()['set-cookie'] || ''
    const match = setCookie.match(/(?:__Host-)?mc-session=([^;]+)/)
    expect(match).toBeTruthy()
    const sessionCookiePair = match?.[0] || ''

    // Use the same cookie name/value returned by login
    const meRes = await request.get('/api/auth/me', {
      headers: { 'cookie': sessionCookiePair, 'x-forwarded-for': '10.88.88.2' }
    })
    expect(meRes.status()).toBe(200)

    const body = await meRes.json()
    expect(body.user?.username).toBe(TEST_USER)
    expect(typeof body.user?.workspace_id).toBe('number')
    expect(typeof body.user?.tenant_id).toBe('number')
  })
})
