import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const {
  archiveOrphanTranscriptsForStateDirMock,
  logAuditEventMock,
  openClawMaintenanceLimiterMock,
  requireRoleMock,
  runOpenClawMock,
} = vi.hoisted(() => ({
  archiveOrphanTranscriptsForStateDirMock: vi.fn(),
  logAuditEventMock: vi.fn(),
  openClawMaintenanceLimiterMock: vi.fn(),
  requireRoleMock: vi.fn(),
  runOpenClawMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/command', () => ({ runOpenClaw: runOpenClawMock }))
vi.mock('@/lib/db', () => ({ logAuditEvent: logAuditEventMock }))
vi.mock('@/lib/rate-limit', () => ({ openClawMaintenanceLimiter: openClawMaintenanceLimiterMock }))
vi.mock('@/lib/config', () => ({ config: { openclawStateDir: '/tmp/openclaw-state' } }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), child: () => ({ error: vi.fn() }) },
}))
vi.mock('@/lib/openclaw-doctor-fix', () => ({
  archiveOrphanTranscriptsForStateDir: archiveOrphanTranscriptsForStateDirMock,
}))
vi.mock('@/lib/openclaw-doctor', () => ({
  parseOpenClawDoctorOutput: (raw: string) => ({
    healthy: true,
    level: 'ok',
    issues: [],
    raw,
  }),
}))

const admin = {
  user: { id: 7, username: 'admin', role: 'admin', workspace_id: 3, tenant_id: 9 },
}

function request(path: string, body: string) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

describe('OpenClaw maintenance route security', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRoleMock.mockReturnValue(admin)
    openClawMaintenanceLimiterMock.mockReturnValue(null)
    archiveOrphanTranscriptsForStateDirMock.mockReturnValue({ archivedOrphans: 0, storesScanned: 1 })
  })

  it.each([
    ['update', '/api/openclaw/update', 'update_openclaw'],
    ['doctor fix', '/api/openclaw/doctor', 'fix_openclaw'],
  ])('authenticates before limiting, parsing, or executing %s', async (kind, path, confirmation) => {
    requireRoleMock.mockReturnValue({ error: 'Authentication required', status: 401 })
    const route = kind === 'update'
      ? await import('@/app/api/openclaw/update/route')
      : await import('@/app/api/openclaw/doctor/route')

    const response = await route.POST(request(path, JSON.stringify({ confirmation })))

    expect(response.status).toBe(401)
    expect(openClawMaintenanceLimiterMock).not.toHaveBeenCalled()
    expect(runOpenClawMock).not.toHaveBeenCalled()
  })

  it.each([
    ['update', '/api/openclaw/update'],
    ['doctor fix', '/api/openclaw/doctor'],
  ])('shares a critical identity limiter before parsing %s', async (kind, path) => {
    openClawMaintenanceLimiterMock.mockReturnValue(
      NextResponse.json({ error: 'Too many maintenance attempts' }, { status: 429 }),
    )
    const route = kind === 'update'
      ? await import('@/app/api/openclaw/update/route')
      : await import('@/app/api/openclaw/doctor/route')

    const response = await route.POST(request(path, '{not-json'))

    expect(response.status).toBe(429)
    expect(openClawMaintenanceLimiterMock).toHaveBeenCalledWith('9:3:7')
    expect(runOpenClawMock).not.toHaveBeenCalled()
  })

  it.each([
    ['update', '/api/openclaw/update'],
    ['doctor fix', '/api/openclaw/doctor'],
  ])('rejects malformed and unconfirmed %s requests without commands', async (kind, path) => {
    const route = kind === 'update'
      ? await import('@/app/api/openclaw/update/route')
      : await import('@/app/api/openclaw/doctor/route')

    const malformed = await route.POST(request(path, '{not-json'))
    const unconfirmed = await route.POST(request(path, '{}'))

    expect(malformed.status).toBe(400)
    expect(unconfirmed.status).toBe(400)
    expect(runOpenClawMock).not.toHaveBeenCalled()
  })

  it('updates stable OpenClaw without returning command output', async () => {
    runOpenClawMock
      .mockResolvedValueOnce({ stdout: 'OpenClaw 1.2.3', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: 'SENSITIVE_UPDATE_OUTPUT', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: 'OpenClaw 1.2.4', stderr: '', code: 0 })
    const { POST } = await import('@/app/api/openclaw/update/route')

    const response = await POST(request('/api/openclaw/update', JSON.stringify({ confirmation: 'update_openclaw' })))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, previousVersion: '1.2.3', newVersion: '1.2.4' })
    expect(JSON.stringify(body)).not.toContain('SENSITIVE_UPDATE_OUTPUT')
    expect(logAuditEventMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'openclaw.update' }))
  })

  it('sanitizes OpenClaw update failures', async () => {
    runOpenClawMock
      .mockResolvedValueOnce({ stdout: 'OpenClaw 1.2.3', stderr: '', code: 0 })
      .mockRejectedValueOnce(Object.assign(new Error('secret path'), { stderr: '/private/operator/token' }))
    const { POST } = await import('@/app/api/openclaw/update/route')

    const response = await POST(request('/api/openclaw/update', JSON.stringify({ confirmation: 'update_openclaw' })))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'OpenClaw update failed' })
    expect(JSON.stringify(body)).not.toContain('/private/operator/token')
  })

  it('returns bounded doctor-fix progress without command output', async () => {
    runOpenClawMock
      .mockResolvedValueOnce({ stdout: 'SENSITIVE_FIX_OUTPUT', stderr: '', code: 0 })
      .mockRejectedValueOnce(Object.assign(new Error('cleanup failed'), { stderr: 'SENSITIVE_CLEANUP_ERROR' }))
      .mockResolvedValueOnce({ stdout: 'SENSITIVE_POST_FIX_OUTPUT', stderr: '', code: 0 })
    const { POST } = await import('@/app/api/openclaw/doctor/route')

    const response = await POST(request('/api/openclaw/doctor', JSON.stringify({ confirmation: 'fix_openclaw' })))
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body.progress[1]).toEqual({ step: 'sessions', detail: 'Session cleanup could not complete.' })
    expect(body.status.raw).toBeUndefined()
    expect(serialized).not.toContain('SENSITIVE_FIX_OUTPUT')
    expect(serialized).not.toContain('SENSITIVE_CLEANUP_ERROR')
    expect(serialized).not.toContain('SENSITIVE_POST_FIX_OUTPUT')
    expect(logAuditEventMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'openclaw.doctor.fix' }))
  })

  it('sanitizes doctor-fix failures', async () => {
    runOpenClawMock.mockRejectedValueOnce(
      Object.assign(new Error('doctor failed'), { stderr: 'SENSITIVE_DOCTOR_ERROR', code: 2 }),
    )
    const { POST } = await import('@/app/api/openclaw/doctor/route')

    const response = await POST(request('/api/openclaw/doctor', JSON.stringify({ confirmation: 'fix_openclaw' })))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'OpenClaw doctor fix failed' })
    expect(JSON.stringify(body)).not.toContain('SENSITIVE_DOCTOR_ERROR')
  })
})
