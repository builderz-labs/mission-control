import { test, expect } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('GitHub Sync API', () => {
  // ── GET /api/github ────────────────────────────

  test('GET /api/github?action=issues requires auth', async ({ request }) => {
    const res = await request.get('/api/github?action=issues&repo=owner/repo')
    expect(res.status()).toBe(401)
  })

  test('GET /api/github?action=issues returns error without GITHUB_TOKEN', async ({ request }) => {
    const res = await request.get('/api/github?action=issues&repo=owner/repo', {
      headers: API_KEY_HEADER,
    })
    // Either 400 (token not configured) or 500 (API error) are acceptable
    expect([400, 500]).toContain(res.status())
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  test('GET /api/github rejects invalid action', async ({ request }) => {
    const res = await request.get('/api/github?action=invalid', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Unknown action')
  })

  // ── POST /api/github ───────────────────────────

  test('POST /api/github with action=status returns sync history', async ({ request }) => {
    const res = await request.post('/api/github', {
      headers: API_KEY_HEADER,
      data: { action: 'status' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.syncs).toBeDefined()
    expect(Array.isArray(body.syncs)).toBe(true)
  })

  test('POST /api/github with action=sync requires repo param', async ({ request }) => {
    const res = await request.post('/api/github', {
      headers: API_KEY_HEADER,
      data: { action: 'sync' },
    })
    // Should fail because no repo and no GITHUB_DEFAULT_REPO
    expect([400, 500]).toContain(res.status())
  })

  test('POST /api/github rejects invalid repo format', async ({ request }) => {
    const res = await request.post('/api/github', {
      headers: API_KEY_HEADER,
      data: { action: 'sync', repo: 'invalid-no-slash' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error || body.details).toBeDefined()
  })
})
