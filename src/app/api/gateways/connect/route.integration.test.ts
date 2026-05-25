/**
 * Integration regression tests for POST /api/gateways/connect.
 *
 * Verifies the end-to-end ws_url resolution through the real POST
 * handler (with mocked auth + db + tailscale + runtime token). Guards
 * the WS handshake bug fix (2026-05-25): docker-DNS gateway.host must
 * be rewritten to the public holalumina.com domain when the browser
 * is on a mc-<tenant>.holalumina.com satellite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const getDetectedGatewayToken = vi.fn(() => '')
const isTailscaleServe = vi.fn(() => false)
const refreshTailscaleCache = vi.fn()
const getCachedTailscaleWeb = vi.fn(() => ({}))
const hasGwPathHandler = vi.fn(() => false)
const findTailscaleServePort = vi.fn(() => null)

const prepare = vi.fn()
const exec = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole }))
vi.mock('@/lib/db', () => ({ getDatabase: vi.fn(() => ({ prepare, exec })) }))
vi.mock('@/lib/gateway-runtime', () => ({ getDetectedGatewayToken }))
vi.mock('@/lib/tailscale-serve', () => ({
  isTailscaleServe,
  refreshTailscaleCache,
  getCachedTailscaleWeb,
  hasGwPathHandler,
  findTailscaleServePort,
}))

interface FakeGatewayRow {
  id: number
  host: string
  port: number
  token: string
  is_primary: number
}

function mockGatewayRow(row: FakeGatewayRow) {
  const selectStmt = { get: vi.fn(() => row) }
  const updateStmt = { run: vi.fn() }
  prepare.mockImplementation((sql: string) => {
    if (sql.startsWith('SELECT id, host, port, token, is_primary FROM gateways')) return selectStmt
    if (sql.startsWith('UPDATE gateways SET token')) return updateStmt
    throw new Error(`Unexpected SQL: ${sql}`)
  })
}

function buildPostRequest(host: string, body: Record<string, unknown> = { id: 1 }): NextRequest {
  return new NextRequest(`https://${host}/api/gateways/connect`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      host,
      'x-forwarded-host': host,
      'x-forwarded-proto': 'https',
      origin: `https://${host}`,
    },
  })
}

describe('POST /api/gateways/connect — ws_url resolution', () => {
  beforeEach(() => {
    vi.resetModules()
    requireRole.mockReturnValue({ user: { id: 1, role: 'admin' } })
    prepare.mockReset()
    isTailscaleServe.mockReturnValue(false)
    getDetectedGatewayToken.mockReturnValue('')
    delete process.env.NEXT_PUBLIC_GATEWAY_URL
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rewrites docker-DNS gateway.host to public holalumina.com domain (REGRESSION: WS handshake bug 2026-05-25)', async () => {
    mockGatewayRow({ id: 1, host: 'ceremonia-gateway', port: 18789, token: 'tok-1', is_primary: 1 })

    const { POST } = await import('./route')
    const response = await POST(buildPostRequest('mc-ceremonia.holalumina.com'))
    const body = await response.json()

    expect(response.status).toBe(200)
    // Critical: NOT wss://ceremonia-gateway (browser-unresolvable docker DNS).
    // NOT wss://mc-ceremonia.holalumina.com/ (Clerk-gated, 307 → handshake dies).
    expect(body.ws_url).toBe('wss://ceremonia.holalumina.com/')
    expect(body.token).toBe('tok-1')
    expect(body.token_set).toBe(true)
  })

  it('handles slug asymmetry — mc-eric → ericedmeades-gateway → ericedmeades.holalumina.com', async () => {
    mockGatewayRow({ id: 1, host: 'ericedmeades-gateway', port: 18789, token: 'tok-2', is_primary: 1 })

    const { POST } = await import('./route')
    const response = await POST(buildPostRequest('mc-eric.holalumina.com'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ws_url).toBe('wss://ericedmeades.holalumina.com/')
  })

  it('handles mc-lumina tenant', async () => {
    mockGatewayRow({ id: 1, host: 'lumina-gateway', port: 18789, token: 'tok-3', is_primary: 1 })

    const { POST } = await import('./route')
    const response = await POST(buildPostRequest('mc-lumina.holalumina.com'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ws_url).toBe('wss://lumina.holalumina.com/')
  })

  it('NEXT_PUBLIC_GATEWAY_URL env override takes highest precedence', async () => {
    // Operator workaround path — explicit env beats auto-rewrite.
    process.env.NEXT_PUBLIC_GATEWAY_URL = 'wss://explicit.example.com/custom'
    mockGatewayRow({ id: 1, host: 'ceremonia-gateway', port: 18789, token: 'tok-1', is_primary: 1 })

    const { POST } = await import('./route')
    const response = await POST(buildPostRequest('mc-ceremonia.holalumina.com'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ws_url).toBe('wss://explicit.example.com/custom')
  })

  it('preserves existing behavior — browser-reachable gateway.host passes through', async () => {
    mockGatewayRow({ id: 1, host: 'ceremonia.holalumina.com', port: 18789, token: 'tok-1', is_primary: 1 })

    const { POST } = await import('./route')
    const response = await POST(buildPostRequest('mc-ceremonia.holalumina.com'))
    const body = await response.json()

    expect(response.status).toBe(200)
    // shouldOmitPort fires for port 18789 + non-local + wss → bare URL.
    expect(body.ws_url).toBe('wss://ceremonia.holalumina.com')
  })

  it('preserves existing behavior — localhost dev unchanged', async () => {
    mockGatewayRow({ id: 1, host: '127.0.0.1', port: 18789, token: 'tok-1', is_primary: 1 })

    const { POST } = await import('./route')
    const request = new NextRequest('http://localhost:3000/api/gateways/connect', {
      method: 'POST',
      body: JSON.stringify({ id: 1 }),
      headers: {
        'content-type': 'application/json',
        host: 'localhost:3000',
        'x-forwarded-proto': 'http',
        origin: 'http://localhost:3000',
      },
    })
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ws_url).toBe('ws://127.0.0.1:18789')
  })

  it('does NOT rewrite when browser is on non-holalumina host (guard against unrelated deployments)', async () => {
    mockGatewayRow({ id: 1, host: 'ceremonia-gateway', port: 18789, token: 'tok-1', is_primary: 1 })

    const { POST } = await import('./route')
    const request = new NextRequest('https://mc-ceremonia.example.com/api/gateways/connect', {
      method: 'POST',
      body: JSON.stringify({ id: 1 }),
      headers: {
        'content-type': 'application/json',
        host: 'mc-ceremonia.example.com',
        'x-forwarded-host': 'mc-ceremonia.example.com',
        'x-forwarded-proto': 'https',
        origin: 'https://mc-ceremonia.example.com',
      },
    })
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    // Should NOT rewrite to *.holalumina.com — falls back to direct host:port.
    expect(body.ws_url).toBe('wss://mc-ceremonia.example.com:18789')
  })

  it('returns 400 when id is missing', async () => {
    const { POST } = await import('./route')
    const response = await POST(buildPostRequest('mc-ceremonia.holalumina.com', {}))
    expect(response.status).toBe(400)
  })

  it('returns 404 when gateway not found', async () => {
    const selectStmt = { get: vi.fn(() => undefined) }
    prepare.mockImplementation(() => selectStmt)

    const { POST } = await import('./route')
    const response = await POST(buildPostRequest('mc-ceremonia.holalumina.com'))
    expect(response.status).toBe(404)
  })

  it('returns 401 on auth failure', async () => {
    requireRole.mockReturnValue({ error: 'Unauthorized', status: 401 })

    const { POST } = await import('./route')
    const response = await POST(buildPostRequest('mc-ceremonia.holalumina.com'))
    expect(response.status).toBe(401)
  })

  it('refreshes detected token for primary gateway when different from db', async () => {
    mockGatewayRow({ id: 1, host: 'ceremonia-gateway', port: 18789, token: 'old', is_primary: 1 })
    getDetectedGatewayToken.mockReturnValue('new-detected-token')

    const { POST } = await import('./route')
    const response = await POST(buildPostRequest('mc-ceremonia.holalumina.com'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.token).toBe('new-detected-token')
    // ws_url rewrite still applies.
    expect(body.ws_url).toBe('wss://ceremonia.holalumina.com/')
  })
})
