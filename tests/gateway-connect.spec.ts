import { expect, test } from '@playwright/test'
import { API_KEY_HEADER } from './helpers'

test.describe('Gateway Connect API', () => {
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

  test('returns ws_url and token for selected gateway', async ({ request }) => {
    const createRes = await request.post('/api/gateways', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-gw-${Date.now()}`,
        host: 'https://example.tailnet.ts.net:4443',
        port: 18789,
        path: '/api/gateway/ws',
        token: 'gw-token-123',
      },
    })
    expect(createRes.status()).toBe(201)
    const createBody = await createRes.json()
    const gatewayId = createBody.gateway?.id as number
    cleanup.push(gatewayId)

    const connectRes = await request.post('/api/gateways/connect', {
      headers: API_KEY_HEADER,
      data: { id: gatewayId },
    })
    expect(connectRes.status()).toBe(200)
    const connectBody = await connectRes.json()

    expect(connectBody.ws_url).toBe('wss://example.tailnet.ts.net:4443/api/gateway/ws')
    expect(connectBody.token).toBe('gw-token-123')
    expect(connectBody.token_set).toBe(true)
  })

  test('returns 404 for unknown gateway', async ({ request }) => {
    const res = await request.post('/api/gateways/connect', {
      headers: API_KEY_HEADER,
      data: { id: 999999 },
    })
    expect(res.status()).toBe(404)
  })

  test('drops https path when no override path is configured', async ({ request }) => {
    const createRes = await request.post('/api/gateways', {
      headers: API_KEY_HEADER,
      data: {
        name: `e2e-gw-path-${Date.now()}`,
        host: 'https://example.tailnet.ts.net:4443/sessions',
        port: 18789,
        token: 'gw-token-456',
      },
    })
    expect(createRes.status()).toBe(201)
    const createBody = await createRes.json()
    const gatewayId = createBody.gateway?.id as number
    cleanup.push(gatewayId)

    const connectRes = await request.post('/api/gateways/connect', {
      headers: API_KEY_HEADER,
      data: { id: gatewayId },
    })
    expect(connectRes.status()).toBe(200)
    const connectBody = await connectRes.json()

    expect(connectBody.ws_url).toBe('wss://example.tailnet.ts.net:4443')
    expect(connectBody.token).toBe('gw-token-456')
    expect(connectBody.token_set).toBe(true)
  })
})
