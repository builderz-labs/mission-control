import { test, expect } from '@playwright/test'

test.describe('OpenAPI Documentation', () => {
  test('GET /api/docs returns valid OpenAPI 3.1 JSON', async ({ request }) => {
    const res = await request.get('/api/docs')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('application/json')

    const spec = await res.json()
    expect(spec.openapi).toMatch(/^3\.1/)
    expect(spec.info).toBeDefined()
    expect(spec.info.title).toBe('Mission Control API')
    expect(spec.info.version).toBeDefined()
    expect(spec.paths).toBeDefined()
  })

  test('GET /api/docs includes key paths', async ({ request }) => {
    const res = await request.get('/api/docs')
    const spec = await res.json()

    // Verify core paths exist
    const paths = Object.keys(spec.paths)
    expect(paths).toContain('/api/agents')
    expect(paths).toContain('/api/tasks')
    expect(paths).toContain('/api/tokens')
    expect(paths).toContain('/api/auth/login')
  })

  test('GET /api/docs is accessible without auth', async ({ request }) => {
    // No API key header, no session cookie
    const res = await request.get('/api/docs', { headers: {} })
    expect(res.status()).toBe(200)
    const spec = await res.json()
    expect(spec.openapi).toBeDefined()
  })
})
