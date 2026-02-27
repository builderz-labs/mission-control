import { test, expect } from '@playwright/test'

/**
 * E2E tests for Issue #5 — Timing-safe API key comparison
 * Verifies that API key auth works correctly after safeCompare migration.
 */

test.describe('Timing-Safe Auth (Issue #5)', () => {
  test('valid API key authenticates successfully', async ({ request }) => {
    const res = await request.get('/api/status', {
      headers: { 'x-api-key': 'test-api-key-e2e-12345' }
    })
    expect(res.status()).not.toBe(401)
  })

  test('wrong API key is rejected', async ({ request }) => {
    const res = await request.get('/api/status', {
      headers: { 'x-api-key': 'wrong-key' }
    })
    expect(res.status()).toBe(401)
  })

  test('empty API key is rejected', async ({ request }) => {
    const res = await request.get('/api/status', {
      headers: { 'x-api-key': '' }
    })
    expect(res.status()).toBe(401)
  })

  test('no auth header is rejected', async ({ request }) => {
    const res = await request.get('/api/status')
    expect(res.status()).toBe(401)
  })
})
