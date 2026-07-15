import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const {
  execFileSyncMock,
  hostPackageInstallLimiterMock,
  isTmuxAvailableMock,
  logAuditEventMock,
  requireRoleMock,
} = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  hostPackageInstallLimiterMock: vi.fn(),
  isTmuxAvailableMock: vi.fn(),
  logAuditEventMock: vi.fn(),
  requireRoleMock: vi.fn(),
}))

vi.mock('child_process', () => ({
  default: { execFileSync: execFileSyncMock },
  execFileSync: execFileSyncMock,
}))
vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/db', () => ({ logAuditEvent: logAuditEventMock }))
vi.mock('@/lib/rate-limit', () => ({ hostPackageInstallLimiter: hostPackageInstallLimiterMock }))
vi.mock('@/lib/pty-manager', () => ({ isTmuxAvailable: isTmuxAvailableMock }))
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ error: vi.fn(), info: vi.fn() }) },
}))

function request(body: string) {
  return new NextRequest('http://localhost/api/pty/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

const admin = {
  user: { id: 7, username: 'admin', role: 'admin', workspace_id: 3, tenant_id: 9 },
}

describe('PTY setup route security', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRoleMock.mockReturnValue(admin)
    hostPackageInstallLimiterMock.mockReturnValue(null)
    isTmuxAvailableMock.mockReturnValue(false)
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  })

  it('authenticates before rate limiting, parsing, or subprocess execution', async () => {
    requireRoleMock.mockReturnValue({ error: 'Authentication required', status: 401 })
    const { POST } = await import('@/app/api/pty/setup/route')

    const response = await POST(request('{not-json'))

    expect(response.status).toBe(401)
    expect(hostPackageInstallLimiterMock).not.toHaveBeenCalled()
    expect(isTmuxAvailableMock).not.toHaveBeenCalled()
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it('applies the critical identity limiter before parsing or side effects', async () => {
    hostPackageInstallLimiterMock.mockReturnValue(
      NextResponse.json({ error: 'Too many installation attempts' }, { status: 429 }),
    )
    const { POST } = await import('@/app/api/pty/setup/route')

    const response = await POST(request('{not-json'))

    expect(response.status).toBe(429)
    expect(hostPackageInstallLimiterMock).toHaveBeenCalledWith('9:3:7')
    expect(isTmuxAvailableMock).not.toHaveBeenCalled()
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed JSON', '{not-json'],
    ['missing confirmation', '{}'],
    ['incorrect confirmation', JSON.stringify({ confirmation: 'yes' })],
    ['unknown field', JSON.stringify({ confirmation: 'install_tmux', package: 'curl' })],
  ])('rejects %s before host probes or execution', async (_label, body) => {
    const { POST } = await import('@/app/api/pty/setup/route')

    const response = await POST(request(body))

    expect(response.status).toBe(400)
    expect(isTmuxAvailableMock).not.toHaveBeenCalled()
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it('executes only the fixed tmux install command and records an audit event', async () => {
    isTmuxAvailableMock.mockReturnValueOnce(false).mockReturnValueOnce(true)
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'tmux' && args[0] === '-V') return 'tmux 3.5a\n'
      return ''
    })
    const { POST } = await import('@/app/api/pty/setup/route')

    const response = await POST(request(JSON.stringify({ confirmation: 'install_tmux' })))

    expect(response.status).toBe(200)
    expect(execFileSyncMock).toHaveBeenCalledWith('brew', ['install', 'tmux'], expect.objectContaining({
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    }))
    expect(logAuditEventMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'system.package_install',
      actor: 'admin',
      actor_id: 7,
      detail: { package: 'tmux', package_manager: 'brew', platform: 'darwin' },
    }))
  })

  it('does not expose subprocess errors to the client', async () => {
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'brew' && args[0] === 'install') {
        throw new Error('secret host path: /Users/operator/private')
      }
      return ''
    })
    const { POST } = await import('@/app/api/pty/setup/route')

    const response = await POST(request(JSON.stringify({ confirmation: 'install_tmux' })))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      success: false,
      error: 'Failed to install tmux. Check the server logs and package manager state.',
    })
    expect(JSON.stringify(body)).not.toContain('/Users/operator/private')
    expect(logAuditEventMock).not.toHaveBeenCalled()
  })
})
