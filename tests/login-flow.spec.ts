import { test, expect } from '@playwright/test'

/**
 * E2E smoke test — Login flow and session auth
 * Verifies the basic login/session/logout lifecycle works end-to-end.
 */

test.describe('Login Flow', () => {
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
      data: { username: 'testadmin', password: 'testpass123' },
      headers: { 'x-forwarded-for': '10.88.88.1' }
    })
    expect(res.status()).toBe(200)

    const cookies = res.headers()['set-cookie']
    expect(cookies).toBeDefined()
    expect(cookies).toContain('mc-session')
  })

  test('login API rejects wrong password', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { username: 'testadmin', password: 'wrongpassword' },
      headers: { 'x-forwarded-for': '10.77.77.77' }
    })
    expect(res.status()).toBe(401)
  })

  test('session cookie grants API access', async ({ request }) => {
    // Login to get a session
    const loginRes = await request.post('/api/auth/login', {
      data: { username: 'testadmin', password: 'testpass123' },
      headers: { 'x-forwarded-for': '10.88.88.2' }
    })
    expect(loginRes.status()).toBe(200)

    // Extract session cookie from Set-Cookie header
    const setCookie = loginRes.headers()['set-cookie'] || ''
    const match = setCookie.match(/mc-session=([^;]+)/)
    expect(match).toBeTruthy()
    const sessionToken = match![1]

    // Use the session cookie to access /api/auth/me
    const meRes = await request.get('/api/auth/me', {
      headers: { 'cookie': `mc-session=${sessionToken}`, 'x-forwarded-for': '10.88.88.2' }
    })
    expect(meRes.status()).toBe(200)
    const body = await meRes.json()
    expect(body.user?.username).toBe('testadmin')
  })
})
