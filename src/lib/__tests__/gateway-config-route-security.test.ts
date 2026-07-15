import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const {
  fetchMock,
  gatewayConfigMutationLimiterMock,
  isolationMock,
  requireRoleMock,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  gatewayConfigMutationLimiterMock: vi.fn(),
  isolationMock: vi.fn(),
  requireRoleMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/config', () => ({
  config: {
    gatewayHost: '127.0.0.1',
    gatewayPort: 18789,
    openclawConfigPath: '/tmp/mission-control-gateway-config-test.json',
  },
}))
vi.mock('@/lib/db', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/gateway-runtime', () => ({ getDetectedGatewayToken: vi.fn(() => null) }))
vi.mock('@/lib/rate-limit', () => ({
  gatewayConfigMutationLimiter: gatewayConfigMutationLimiterMock,
}))
vi.mock('@/lib/workspace-isolation', () => ({
  denyUnscopedResourceForStrictWorkspace: isolationMock,
}))

const admin = {
  user: { id: 7, username: 'admin', role: 'admin', workspace_id: 3, tenant_id: 9 },
}

function request(body: unknown, action?: string) {
  const suffix = action ? `?action=${action}` : ''
  return new NextRequest(`http://localhost/api/gateway-config${suffix}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('gateway configuration route security', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    requireRoleMock.mockReturnValue(admin)
    isolationMock.mockReturnValue(null)
    gatewayConfigMutationLimiterMock.mockReturnValue(null)
  })

  it('authenticates and isolates before applying the critical limiter', async () => {
    requireRoleMock.mockReturnValue({ error: 'Authentication required', status: 401 })
    const { PUT } = await import('@/app/api/gateway-config/route')

    const response = await PUT(request({}, 'apply'))

    expect(response.status).toBe(401)
    expect(isolationMock).not.toHaveBeenCalled()
    expect(gatewayConfigMutationLimiterMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('limits by authenticated tenant, workspace, and admin before action handling', async () => {
    gatewayConfigMutationLimiterMock.mockReturnValue(
      NextResponse.json({ error: 'Too many gateway configuration changes' }, { status: 429 }),
    )
    const { PUT } = await import('@/app/api/gateway-config/route')

    const response = await PUT(request({}, 'apply'))

    expect(response.status).toBe(429)
    expect(gatewayConfigMutationLimiterMock).toHaveBeenCalledWith('9:3:7')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['__proto__.polluted', 'constructor.prototype.polluted', 'gateway.__proto__.polluted'])(
    'rejects unsafe config path %s before filesystem access',
    async (path) => {
      const { PUT } = await import('@/app/api/gateway-config/route')

      const response = await PUT(request({ updates: { [path]: true } }))

      expect(response.status).toBe(400)
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    },
  )

  it('rejects oversized update maps', async () => {
    const updates = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`gateway.field_${index}`, index]),
    )
    const { PUT } = await import('@/app/api/gateway-config/route')

    const response = await PUT(request({ updates }))

    expect(response.status).toBe(400)
  })

  it.each(['apply', 'update'])('does not reflect upstream text when %s fails', async (action) => {
    fetchMock.mockResolvedValue(new Response('SENSITIVE_GATEWAY_RESPONSE', { status: 503 }))
    const { PUT } = await import('@/app/api/gateway-config/route')

    const response = await PUT(request({}, action))
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.error).toContain('503')
    expect(JSON.stringify(body)).not.toContain('SENSITIVE_GATEWAY_RESPONSE')
  })
})
