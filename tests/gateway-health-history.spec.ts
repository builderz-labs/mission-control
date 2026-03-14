import { expect, test } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Gateway Health History API', () => {
  const cleanup: number[] = []

  test.afterEach(async ({ request }) => {
    for (const id of cleanup) {
      await request.delete('/api/gateways', {
        headers: API_KEY_HEADER,
        data: { id },
      }).catch(() => {})
    }
    cleanup.length = 0
  })

  test('GET /api/gateways/health/history returns history array', async ({ request }) => {
    const res = await request.get('/api/gateways/health/history', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('history')
    expect(Array.isArray(body.history)).toBe(true)
  })

  test('GET /api/gateways/health/history requires authentication', async ({ request }) => {
    const res = await request.get('/api/gateways/health/history')
    expect([401, 403]).toContain(res.status())
  })

  test('history entries have correct structure', async ({ request }) => {
    // First, create a gateway and trigger a health probe to generate log entries
    const createRes = await request.post('/api/gateways', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-history-${Date.now()}`,
        host: 'https://example-gateway.invalid',
        port: 18789,
        token: 'test-token',
      },
    })
    // Gateway creation may or may not succeed depending on config
    if (createRes.status() === 201) {
      const body = await createRes.json()
      cleanup.push(body.gateway?.id)
    }

    // Trigger health probe (this generates log entries)
    await request.post('/api/gateways/health', {
      headers: API_KEY_HEADER,
    })

    const res = await request.get('/api/gateways/health/history', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()

    // If there are entries, validate structure
    for (const gatewayHistory of body.history) {
      expect(gatewayHistory).toHaveProperty('gatewayId')
      expect(typeof gatewayHistory.gatewayId).toBe('number')
      expect(gatewayHistory).toHaveProperty('entries')
      expect(Array.isArray(gatewayHistory.entries)).toBe(true)

      for (const entry of gatewayHistory.entries) {
        expect(entry).toHaveProperty('status')
        expect(['online', 'offline', 'error']).toContain(entry.status)
        expect(entry).toHaveProperty('probed_at')
        expect(typeof entry.probed_at).toBe('number')
        // latency can be null or a number
        if (entry.latency !== null) {
          expect(typeof entry.latency).toBe('number')
        }
        // error can be null or a string
        if (entry.error !== null) {
          expect(typeof entry.error).toBe('string')
        }
      }
    }
  })

  test('POST /api/gateways/health probes all gateways and logs results', async ({ request }) => {
    // Create a gateway
    const createRes = await request.post('/api/gateways', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-probe-${Date.now()}`,
        host: 'https://unreachable-host-for-testing.invalid',
        port: 18789,
        token: 'probe-token',
      },
    })
    if (createRes.status() === 201) {
      const body = await createRes.json()
      cleanup.push(body.gateway?.id)
    }

    // Run the health probe
    const probeRes = await request.post('/api/gateways/health', {
      headers: API_KEY_HEADER,
    })
    expect(probeRes.status()).toBe(200)

    const probeBody = await probeRes.json()
    expect(probeBody).toHaveProperty('results')
    expect(probeBody).toHaveProperty('probed_at')
    expect(Array.isArray(probeBody.results)).toBe(true)
    expect(typeof probeBody.probed_at).toBe('number')

    // Each result should have proper shape
    for (const result of probeBody.results) {
      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('status')
      expect(['online', 'offline', 'error']).toContain(result.status)
      expect(result).toHaveProperty('agents')
      expect(result).toHaveProperty('sessions_count')
    }
  })

  test('POST /api/gateways/health requires authentication', async ({ request }) => {
    const res = await request.post('/api/gateways/health')
    expect([401, 403]).toContain(res.status())
  })

  test('history is ordered by most recent first', async ({ request }) => {
    // Trigger a couple of probes
    await request.post('/api/gateways/health', { headers: API_KEY_HEADER })
    await request.post('/api/gateways/health', { headers: API_KEY_HEADER })

    const res = await request.get('/api/gateways/health/history', {
      headers: API_KEY_HEADER,
    })
    expect(res.status()).toBe(200)
    const body = await res.json()

    for (const gatewayHistory of body.history) {
      const timestamps = gatewayHistory.entries.map((e: { probed_at: number }) => e.probed_at)
      // Verify descending order (most recent first)
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i])
      }
    }
  })

  test('gateway name is included in history when available', async ({ request }) => {
    const uniqueName = `e2e-named-gw-${Date.now()}`
    const createRes = await request.post('/api/gateways', {
      headers: API_KEY_HEADER,
      data: {
        name: uniqueName,
        host: 'https://unreachable-named.invalid',
        port: 18789,
        token: 'named-token',
      },
    })

    if (createRes.status() !== 201) return // skip if creation fails

    const createdId = (await createRes.json()).gateway?.id as number
    cleanup.push(createdId)

    // Probe to generate a log entry for this gateway
    await request.post('/api/gateways/health', { headers: API_KEY_HEADER })

    const histRes = await request.get('/api/gateways/health/history', {
      headers: API_KEY_HEADER,
    })
    expect(histRes.status()).toBe(200)
    const histBody = await histRes.json()

    const found = histBody.history.find((h: { gatewayId: number }) => h.gatewayId === createdId)
    if (found) {
      expect(found.name).toBe(uniqueName)
    }
  })
})
