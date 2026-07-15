import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const {
  gatewayControlLimiterMock,
  isolationMock,
  logAuditEventMock,
  requireRoleMock,
  runCommandMock,
} = vi.hoisted(() => ({
  gatewayControlLimiterMock: vi.fn(),
  isolationMock: vi.fn(),
  logAuditEventMock: vi.fn(),
  requireRoleMock: vi.fn(),
  runCommandMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/command', () => ({ runCommand: runCommandMock }))
vi.mock('@/lib/db', () => ({ logAuditEvent: logAuditEventMock }))
vi.mock('@/lib/rate-limit', () => ({ gatewayControlLimiter: gatewayControlLimiterMock }))
vi.mock('@/lib/workspace-isolation', () => ({
  denyUnscopedResourceForStrictWorkspace: isolationMock,
}))
vi.mock('@/lib/config', () => ({
  config: {
    homeDir: '/tmp/mission-control-gateway-test',
    openclawBin: 'openclaw',
    openclawConfigPath: '/tmp/missing-openclaw.json',
  },
}))
vi.mock('@/lib/hermes-sessions', () => ({ isHermesGatewayRunning: vi.fn(() => false) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

const admin = {
  user: { id: 7, username: 'admin', role: 'admin', workspace_id: 3, tenant_id: 9 },
}

function request(body: string) {
  return new NextRequest('http://localhost/api/gateways/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

describe('gateway control route security', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRoleMock.mockReturnValue(admin)
    isolationMock.mockReturnValue(null)
    gatewayControlLimiterMock.mockReturnValue(null)
    runCommandMock.mockResolvedValue({ stdout: 'ok', stderr: '', code: 0 })
  })

  it('authenticates and isolates before limiting or parsing', async () => {
    requireRoleMock.mockReturnValue({ error: 'Authentication required', status: 401 })
    const { POST } = await import('@/app/api/gateways/control/route')

    const response = await POST(request('{not-json'))

    expect(response.status).toBe(401)
    expect(isolationMock).not.toHaveBeenCalled()
    expect(gatewayControlLimiterMock).not.toHaveBeenCalled()
    expect(runCommandMock).not.toHaveBeenCalled()
  })

  it('applies a critical identity limiter before parsing or execution', async () => {
    gatewayControlLimiterMock.mockReturnValue(
      NextResponse.json({ error: 'Too many gateway control attempts' }, { status: 429 }),
    )
    const { POST } = await import('@/app/api/gateways/control/route')

    const response = await POST(request('{not-json'))

    expect(response.status).toBe(429)
    expect(gatewayControlLimiterMock).toHaveBeenCalledWith('9:3:7')
    expect(runCommandMock).not.toHaveBeenCalled()
  })

  it.each([
    {},
    { gateway: 'unknown', action: 'start' },
    { gateway: 'openclaw', action: 'destroy' },
  ])('rejects invalid control input without executing commands', async (body) => {
    const { POST } = await import('@/app/api/gateways/control/route')

    const response = await POST(request(JSON.stringify(body)))

    expect(response.status).toBe(400)
    expect(runCommandMock).not.toHaveBeenCalled()
    expect(logAuditEventMock).not.toHaveBeenCalled()
  })

  it('redacts and bounds command output while attributing the action', async () => {
    const token = `ghp_${'a'.repeat(40)}`
    runCommandMock.mockResolvedValue({
      stdout: `${token}\ngateway_token=plain-secret-value\n${'x'.repeat(20_000)}`,
      stderr: '',
      code: 0,
    })
    const { POST } = await import('@/app/api/gateways/control/route')

    const response = await POST(request(JSON.stringify({ gateway: 'openclaw', action: 'diagnose' })))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.output).not.toContain(token)
    expect(body.output).not.toContain('plain-secret-value')
    expect(body.output).toContain('***REDACTED***')
    expect(body.output).toContain('…[truncated]')
    expect(body.output.length).toBeLessThanOrEqual(16_020)
    expect(logAuditEventMock).toHaveBeenCalledWith({
      action: 'gateway.control',
      actor: 'admin',
      actor_id: 7,
      target_type: 'runtime',
      detail: { gateway: 'openclaw', action: 'diagnose' },
    })
  })
})
