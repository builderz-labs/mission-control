import { expect, test } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Fly fleet telemetry', () => {
  test('requires a Mission Control viewer credential', async ({ request }) => {
    const response = await request.get('/api/fly/telemetry')
    expect(response.status()).toBe(401)
  })

  test('returns a live scheduler-to-fleet snapshot', async ({ request }) => {
    const response = await request.get('/api/fly/telemetry', { headers: API_KEY_HEADER })
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      queue: expect.any(Object), fleet: expect.any(Object), cost: expect.any(Object), mac: expect.any(Object),
    })
    expect(body.fleet.capacity).toBeGreaterThan(0)
    expect(body.mac.swap_bytes).toBeGreaterThanOrEqual(0)
  })
})
