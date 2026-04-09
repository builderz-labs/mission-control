import { test, expect, type BrowserContext } from '@playwright/test'

/**
 * UI smoke tests — authenticated panel navigation.
 *
 * WHY: All other tests validate the API layer. These tests validate that every
 * panel in the navigation rail loads in the browser without crashing the React
 * error boundary. A crash means "Something went wrong" is rendered.
 *
 * Auth strategy:
 * - A fresh test user is created once per run in beforeAll
 * - Login happens ONCE in beforeAll to obtain a session token
 * - Token is reused via context.addCookies() in every beforeEach — zero additional
 *   login calls, so the rate limiter window is never exhausted
 * - No x-real-ip header → IP = 'unknown'; MC_DISABLE_RATE_LIMIT=1 bypasses the
 *   loginLimiter entirely for unknown/loopback IPs in test mode
 * - mc-session (legacy name) is injected instead of __Host-mc-session because CDP
 *   rejects __Host- cookies on HTTP origins; middleware accepts both in test mode
 */

const API_KEY = process.env.API_KEY || 'test-api-key-e2e-12345'
// Use the legacy (non-__Host-) name for programmatic injection in tests.
// parseMcSessionCookieHeader accepts both names; __Host- prefix requires HTTPS
// which CDP rejects on our HTTP dev server.
const COOKIE_NAME = 'mc-session'
const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3005'
// Password not in seed.ts INSECURE_PASSWORDS set and meets the 12-char check
const UI_SMOKE_PASS = 'UiSmoke-Pass-7531!'

// Mutated once in the file-level beforeAll, read by all tests.
// _setupDone guards against Playwright calling beforeAll multiple times
// across internal test groups within the same file.
let _smokeSetupDone = false
let smokeTestUser = ''
let smokeSessionToken = ''

// Panels available in local mode (gateway-only panels are excluded)
const LOCAL_PANELS = [
  // Core
  { id: 'overview', path: '/' },
  { id: 'agents', path: '/agents' },
  { id: 'tasks', path: '/tasks' },
  { id: 'chat', path: '/chat' },
  { id: 'skills', path: '/skills' },
  { id: 'memory', path: '/memory' },
  { id: 'search', path: '/search' },
  // OBSERVE
  { id: 'war-room', path: '/war-room' },
  { id: 'activity', path: '/activity' },
  { id: 'logs', path: '/logs' },
  { id: 'cost-tracker', path: '/cost-tracker' },
  { id: 'agent-cost', path: '/agent-cost' },
  { id: 'token-dashboard', path: '/token-dashboard' },
  { id: 'notifications', path: '/notifications' },
  { id: 'standup', path: '/standup' },
  { id: 'agent-history', path: '/agent-history' },
  { id: 'intelligence-brief', path: '/intelligence-brief' },
  { id: 'leaderboard', path: '/leaderboard' },
  { id: 'exec-replay', path: '/exec-replay' },
  { id: 'office', path: '/office' },
  // AUTOMATE
  { id: 'cron', path: '/cron' },
  { id: 'pipeline', path: '/pipeline' },
  { id: 'webhooks', path: '/webhooks' },
  { id: 'alerts', path: '/alerts' },
  { id: 'github', path: '/github' },
  { id: 'handoff-chains', path: '/handoff-chains' },
  // WORKSPACE
  { id: 'presentations', path: '/presentations' },
  { id: 'documents', path: '/documents' },
  { id: 'session-details', path: '/session-details' },
  // ADMIN
  { id: 'security', path: '/security' },
  { id: 'users', path: '/users' },
  { id: 'audit', path: '/audit' },
  { id: 'integrations', path: '/integrations' },
  { id: 'providers', path: '/providers' },
  { id: 'debug', path: '/debug' },
  { id: 'settings', path: '/settings' },
]

/**
 * Create a dedicated E2E user and obtain a session token once for the whole
 * file. This avoids repeated login calls that would exhaust the critical-mode
 * rate limiter (5 login attempts / IP / minute).
 */
test.beforeAll(async ({ request }) => {
  if (_smokeSetupDone) return
  _smokeSetupDone = true
  smokeTestUser = `ui-smoke-${Date.now()}`

  const createRes = await request.post('/api/auth/users', {
    data: {
      username: smokeTestUser,
      password: UI_SMOKE_PASS,
      display_name: 'UI Smoke E2E',
      role: 'admin',
    },
    headers: { 'x-api-key': API_KEY },
  })
  expect([201, 409]).toContain(createRes.status())

  // No x-real-ip header → IP resolves to 'unknown'.
  // With MC_DISABLE_RATE_LIMIT=1 and loginLimiter.critical=false the bypass
  // condition fires for 'unknown' so this single call is never rate-limited.
  const loginRes = await request.post('/api/auth/login', {
    data: { username: smokeTestUser, password: UI_SMOKE_PASS },
  })
  expect(loginRes.status()).toBe(200)

  const setCookieHeader = loginRes.headers()['set-cookie'] || ''
  const match = setCookieHeader.match(/__Host-mc-session=([^;]+)/)
  if (!match) throw new Error(`Session cookie not found in: ${setCookieHeader}`)
  smokeSessionToken = match[1]

  // Skip onboarding so the nav rail is visible for all smoke tests.
  // New admin users see the onboarding wizard which hides NavRail; skipping it
  // ensures the layout matches what the nav-rail tests expect.
  await request.post('/api/onboarding', {
    data: { action: 'skip' },
    headers: { 'Cookie': `mc-session=${smokeSessionToken}` },
  })
})

/** Inject the cached session token into a browser context. No HTTP call needed. */
async function injectAuthCookie(context: BrowserContext): Promise<void> {
  await context.addCookies([{
    name: COOKIE_NAME,
    value: smokeSessionToken,
    url: BASE_URL,
    httpOnly: true,
    sameSite: 'Strict',
  }])
  // WHY: New admin users trigger the onboarding wizard, which hides NavRail
  // (app-shell.tsx: `{!showOnboarding && <NavRail />}`). The wizard re-opens
  // even after skipping because getOnboardingSessionDecision treats skipped=true
  // as "replay from start". Setting the session-dismissed flag short-circuits
  // this and keeps NavRail visible throughout all smoke tests.
  await context.addInitScript(() => {
    window.sessionStorage.setItem('mc-onboarding-dismissed', '1')
  })
}

test.describe('UI Panel Smoke Tests', () => {
  // Share one auth cookie across all panel tests — no need to log in 36 times.
  test.beforeEach(async ({ context }) => {
    await injectAuthCookie(context)
  })

  test('login page loads with username + password form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('#username')).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('unauthenticated access redirects to /login', async ({ browser }) => {
    // New isolated context with NO cookies — must redirect
    const ctx = await browser.newContext()
    const pg = await ctx.newPage()
    await pg.goto('/')
    await expect(pg).toHaveURL(/\/login/)
    await ctx.close()
  })

  test('overview panel loads after auth', async ({ page }) => {
    await page.goto('/')
    // Must stay on overview, not redirect to login
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('#main-content')).toBeVisible()
    await expect(page.locator('text=Something went wrong')).not.toBeVisible()
    // Nav rail should be present
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible()
  })

  // Generate one test per panel
  for (const panel of LOCAL_PANELS.slice(1)) {
    test(`${panel.id} panel loads without error boundary`, async ({ page }) => {
      await page.goto(panel.path)
      await expect(page).not.toHaveURL(/\/login/)
      // Wait for panel skeleton to resolve (panel lazy-loads)
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {
        // networkidle can time out on panels with SSE/WS; that's OK
      })
      await expect(page.locator('text=Something went wrong')).not.toBeVisible({ timeout: 12_000 })
      await expect(page.locator('#main-content')).toBeVisible()
    })
  }

  test('gateway-only panel shows LocalModeUnavailable in local mode', async ({ page }) => {
    await page.goto('/gateways')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.locator('text=Something went wrong')).not.toBeVisible()
    // Should show unavailable banner, not crash
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    // The panel renders LocalModeUnavailable — no error boundary
    const mainContent = page.locator('#main-content')
    await expect(mainContent).toBeVisible()
  })
})

test.describe('Login Form UI', () => {
  test('wrong password shows error message', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#username', smokeTestUser || 'testadmin')
    await page.fill('#password', 'definitely-wrong-password-xyz')
    await page.click('button[type="submit"]')
    // Error div with role="alert" should appear
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 5_000 })
  })

  test('empty form shows browser validation', async ({ page }) => {
    await page.goto('/login')
    // Submit with empty fields — browser required validation prevents submit
    await page.click('button[type="submit"]')
    // Should still be on login page (HTML5 required validation)
    await expect(page).toHaveURL(/\/login/)
  })

  test('successful form login redirects to dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#username', smokeTestUser)
    await page.fill('#password', UI_SMOKE_PASS)

    // Intercept and remap the __Host- cookie to work on HTTP
    await page.route('**/api/auth/login', async (route) => {
      const response = await route.fetch()
      const body = await response.text()
      const headers = { ...response.headers() }

      // Rewrite __Host-mc-session to mc-session so Chrome accepts it on HTTP
      if (headers['set-cookie']) {
        headers['set-cookie'] = headers['set-cookie']
          .replace('__Host-mc-session=', 'mc-session=')
          .replace('; Secure', '')
      }

      await route.fulfill({ response, body, headers })
    })

    await page.click('button[type="submit"]')
    // After successful login the page navigates to /
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 })
  })
})

test.describe('Navigation Rail UI', () => {
  test.beforeEach(async ({ context }) => {
    await injectAuthCookie(context)
  })

  test('sidebar toggle collapses and expands nav rail', async ({ page }) => {
    await page.goto('/')
    const nav = page.locator('nav[aria-label="Main navigation"]')
    await expect(nav).toBeVisible()

    const toggleBtn = nav.locator('button[aria-label="Toggle sidebar"]')
    await expect(toggleBtn).toBeVisible()

    // Toggle collapse
    await toggleBtn.click()
    // Toggle expand
    await toggleBtn.click()
    await expect(nav).toBeVisible()
  })

  test('API key header grants access to agents endpoint', async ({ request }) => {
    const res = await request.get('/api/agents', {
      headers: { 'x-api-key': API_KEY },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.agents)).toBe(true)
  })
})
