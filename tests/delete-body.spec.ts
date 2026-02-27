import { test, expect } from '@playwright/test'

/**
 * E2E tests for Issue #18 — DELETE handlers use request body
 * Verifies that DELETE endpoints require JSON body instead of query params.
 */

const API_KEY_HEADER = { 'x-api-key': 'test-api-key-e2e-12345' }

test.describe('DELETE Body Standardization (Issue #18)', () => {
  test('DELETE /api/pipelines rejects without body', async ({ request }) => {
    const res = await request.delete('/api/pipelines', {
      headers: API_KEY_HEADER
    })
    const body = await res.json()
    expect(body.error).toContain('body required')
    expect(res.status()).toBe(400)
  })

  test('DELETE /api/pipelines accepts body with id', async ({ request }) => {
    const res = await request.delete('/api/pipelines', {
      headers: API_KEY_HEADER,
      data: { id: '99999' }
    })
    // Should not be 400 "body required" — the body was provided
    expect(res.status()).not.toBe(400)
  })

  test('DELETE /api/webhooks rejects without body', async ({ request }) => {
    const res = await request.delete('/api/webhooks', {
      headers: API_KEY_HEADER
    })
    const body = await res.json()
    expect(body.error).toContain('body required')
    expect(res.status()).toBe(400)
  })

  test('DELETE /api/settings rejects without body', async ({ request }) => {
    const res = await request.delete('/api/settings', {
      headers: API_KEY_HEADER
    })
    const body = await res.json()
    expect(body.error).toContain('body required')
    expect(res.status()).toBe(400)
  })

  test('DELETE /api/workflows rejects without body', async ({ request }) => {
    const res = await request.delete('/api/workflows', {
      headers: API_KEY_HEADER
    })
    const body = await res.json()
    expect(body.error).toContain('body required')
    expect(res.status()).toBe(400)
  })

  test('DELETE /api/backup rejects without body', async ({ request }) => {
    const res = await request.delete('/api/backup', {
      headers: API_KEY_HEADER
    })
    const body = await res.json()
    expect(body.error).toContain('body required')
    expect(res.status()).toBe(400)
  })

  test('DELETE /api/auth/users rejects without body', async ({ request }) => {
    const res = await request.delete('/api/auth/users', {
      headers: API_KEY_HEADER
    })
    const body = await res.json()
    expect(body.error).toContain('body required')
  })

  test('old query param style no longer works for DELETE', async ({ request }) => {
    // The old pattern: DELETE /api/pipelines?id=1
    const res = await request.delete('/api/pipelines?id=1', {
      headers: API_KEY_HEADER
    })
    // Without a JSON body, this should fail with "body required"
    const body = await res.json()
    expect(body.error).toContain('body required')
  })
})
