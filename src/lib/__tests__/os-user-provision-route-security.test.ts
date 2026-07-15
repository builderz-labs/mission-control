import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const {
  getDatabaseMock,
  osUserProvisionLimiterMock,
  requireRoleMock,
  resolvePinnedUserToolSpecMock,
  runtimeInstallsEnabledMock,
} = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
  osUserProvisionLimiterMock: vi.fn(),
  requireRoleMock: vi.fn(),
  resolvePinnedUserToolSpecMock: vi.fn(),
  runtimeInstallsEnabledMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: requireRoleMock,
}))

vi.mock('@/lib/rate-limit', () => ({
  osUserProvisionLimiter: osUserProvisionLimiterMock,
}))

vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('@/lib/runtime-install-security', () => ({
  resolvePinnedUserToolSpec: resolvePinnedUserToolSpecMock,
  runtimeInstallsEnabled: runtimeInstallsEnabledMock,
}))

function request(body: string) {
  return new NextRequest('http://localhost/api/super/os-users', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  })
}

describe('OS user provisioning route security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireRoleMock.mockReturnValue({
      user: { id: 7, username: 'admin', role: 'admin', workspace_id: 3, tenant_id: 9 },
    })
    osUserProvisionLimiterMock.mockReturnValue(null)
    runtimeInstallsEnabledMock.mockReturnValue(true)
  })

  it('authenticates before rate limiting or parsing provisioning input', async () => {
    requireRoleMock.mockReturnValue({ error: 'Authentication required', status: 401 })
    const { POST } = await import('@/app/api/super/os-users/route')

    const response = await POST(request('{not-json'))

    expect(response.status).toBe(401)
    expect(osUserProvisionLimiterMock).not.toHaveBeenCalled()
    expect(getDatabaseMock).not.toHaveBeenCalled()
  })

  it('applies the critical identity limiter before parsing or side effects', async () => {
    osUserProvisionLimiterMock.mockReturnValue(
      NextResponse.json({ error: 'Too many provisioning attempts' }, { status: 429 }),
    )
    const { POST } = await import('@/app/api/super/os-users/route')

    const response = await POST(request('{not-json'))

    expect(response.status).toBe(429)
    expect(osUserProvisionLimiterMock).toHaveBeenCalledWith('9:3:7')
    expect(getDatabaseMock).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed JSON', '{not-json'],
    ['unknown fields', JSON.stringify({ username: 'valid-user', display_name: 'Valid', root: true })],
    ['invalid username', JSON.stringify({ username: 'root;shutdown', display_name: 'Invalid' })],
    ['weak password', JSON.stringify({ username: 'valid-user', display_name: 'Valid', password: 'short' })],
    ['invalid gateway port', JSON.stringify({ username: 'valid-user', display_name: 'Valid', gateway_mode: true, gateway_port: 22 })],
    ['missing gateway port', JSON.stringify({ username: 'valid-user', display_name: 'Valid', gateway_mode: true })],
  ])('rejects %s before discovery, database access, or runtime resolution', async (_label, body) => {
    const { POST } = await import('@/app/api/super/os-users/route')

    const response = await POST(request(body))

    expect(response.status).toBe(400)
    expect(getDatabaseMock).not.toHaveBeenCalled()
    expect(runtimeInstallsEnabledMock).not.toHaveBeenCalled()
    expect(resolvePinnedUserToolSpecMock).not.toHaveBeenCalled()
  })
})
