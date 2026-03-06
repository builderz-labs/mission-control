import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockRequireRole, mockLogger, mockConfig, mockManager } = vi.hoisted(() => {
  const mockRequireRole = vi.fn()
  const mockLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }
  const mockConfig = {
    gatewayProxyMode: true,
    gatewayHost: '127.0.0.1',
    gatewayPort: 18789,
  }
  const mockManager = {
    isConnected: vi.fn(() => false),
    connect: vi.fn(),
    callMethod: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  }
  return { mockRequireRole, mockLogger, mockConfig, mockManager }
})

vi.mock('@/lib/auth', () => ({ requireRole: mockRequireRole }))
vi.mock('@/lib/logger', () => ({ logger: mockLogger }))
vi.mock('@/lib/config', () => ({ config: mockConfig }))
vi.mock('@/lib/gateway-proxy', () => ({
  getGatewayProxyManager: () => mockManager,
  ALLOWED_GATEWAY_METHODS: new Set([
    'ping',
    'status',
    'models.list',
    'sessions.list',
    'sessions.send',
    'sessions.spawn',
  ]),
  OPERATOR_GATEWAY_METHODS: new Set(['sessions.send', 'sessions.spawn']),
}))
vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
  readLimiter: vi.fn(() => null),
  extractClientIp: vi.fn(() => '127.0.0.1'),
}))
vi.mock('@/lib/db', () => ({ logAuditEvent: vi.fn() }))

import { POST } from '@/app/api/gateway-proxy/route'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/gateway-proxy', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const authedUser = { id: 1, workspace_id: 1, role: 'operator', username: 'admin' }

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/gateway-proxy — proxy mode disabled', () => {
  beforeEach(() => {
    mockConfig.gatewayProxyMode = false
    mockRequireRole.mockReturnValue({ user: authedUser })
  })
  afterEach(() => {
    mockConfig.gatewayProxyMode = true
    vi.clearAllMocks()
  })

  it('returns 404 when proxy mode is off', async () => {
    const res = await POST(makeRequest({ method: 'ping' }))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/gateway-proxy — auth', () => {
  beforeEach(() => {
    mockConfig.gatewayProxyMode = true
  })
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockRequireRole.mockReturnValue({ error: 'Unauthorized', status: 401 })
    const res = await POST(makeRequest({ method: 'ping' }))
    expect(res.status).toBe(401)
  })
})

describe('POST /api/gateway-proxy — allowlist', () => {
  beforeEach(() => {
    mockConfig.gatewayProxyMode = true
    mockRequireRole.mockReturnValue({ user: authedUser })
  })
  afterEach(() => vi.clearAllMocks())

  it('rejects unlisted methods with 403', async () => {
    const res = await POST(makeRequest({ method: 'agents.delete' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/not allowed/i)
  })

  it('accepts ping (allowed, non-operator method)', async () => {
    mockManager.isConnected.mockReturnValue(true)
    mockManager.callMethod.mockResolvedValue({ ok: true })
    const res = await POST(makeRequest({ method: 'ping' }))
    expect(res.status).toBe(200)
  })

  it('accepts models.list (read-only)', async () => {
    mockManager.isConnected.mockReturnValue(true)
    mockManager.callMethod.mockResolvedValue([])
    const res = await POST(makeRequest({ method: 'models.list' }))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/gateway-proxy — operator gate for mutating methods', () => {
  afterEach(() => vi.clearAllMocks())

  it('requires operator role for sessions.send', async () => {
    mockConfig.gatewayProxyMode = true
    // First requireRole call (viewer check) passes; second (operator check) fails
    mockRequireRole
      .mockReturnValueOnce({ user: { ...authedUser, role: 'viewer' } })
      .mockReturnValueOnce({ error: 'Forbidden', status: 403 })

    const res = await POST(makeRequest({ method: 'sessions.send', params: { sessionId: '1' } }))
    expect(res.status).toBe(403)
  })

  it('allows operator to call sessions.send', async () => {
    mockConfig.gatewayProxyMode = true
    mockRequireRole.mockReturnValue({ user: authedUser }) // operator on both calls
    mockManager.isConnected.mockReturnValue(true)
    mockManager.callMethod.mockResolvedValue({ ok: true })

    const res = await POST(makeRequest({ method: 'sessions.send', params: { sessionId: '1', message: 'hi' } }))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/gateway-proxy — gateway not connected', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 503 and triggers connect when gateway is offline', async () => {
    mockConfig.gatewayProxyMode = true
    mockRequireRole.mockReturnValue({ user: authedUser })
    mockManager.isConnected.mockReturnValue(false)

    const res = await POST(makeRequest({ method: 'ping' }))
    expect(res.status).toBe(503)
    expect(mockManager.connect).toHaveBeenCalled()
  })
})

describe('POST /api/gateway-proxy — missing / invalid body', () => {
  beforeEach(() => {
    mockConfig.gatewayProxyMode = true
    mockRequireRole.mockReturnValue({ user: authedUser })
  })
  afterEach(() => vi.clearAllMocks())

  it('returns 400 when method is missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is not JSON', async () => {
    const req = new NextRequest('http://localhost/api/gateway-proxy', {
      method: 'POST',
      body: 'not-json',
      headers: { 'content-type': 'text/plain' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 413 when content-length header exceeds limit', async () => {
    const req = new NextRequest('http://localhost/api/gateway-proxy', {
      method: 'POST',
      body: JSON.stringify({ method: 'ping' }),
      headers: {
        'content-type': 'application/json',
        'content-length': String(65 * 1024), // >64 KiB
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(413)
  })
})
