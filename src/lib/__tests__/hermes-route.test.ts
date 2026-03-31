import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  getHermesRuntimeStatusMock: vi.fn(),
  isHermesInstalledMock: vi.fn(),
  loggerMock: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  existsSyncMock: vi.fn(() => false),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: mocks.requireRoleMock,
}))

vi.mock('@/lib/hermes-runtime', () => ({
  getHermesRuntimeStatus: mocks.getHermesRuntimeStatusMock,
}))

vi.mock('@/lib/hermes-sessions', () => ({
  isHermesInstalled: mocks.isHermesInstalledMock,
}))

vi.mock('@/lib/logger', () => ({
  logger: mocks.loggerMock,
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: mocks.existsSyncMock,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
  }
})

describe('GET /api/hermes', () => {
  beforeEach(() => {
    mocks.requireRoleMock.mockReset()
    mocks.getHermesRuntimeStatusMock.mockReset()
    mocks.isHermesInstalledMock.mockReset()
    mocks.requireRoleMock.mockReturnValue({ user: { role: 'viewer' } })
    mocks.getHermesRuntimeStatusMock.mockReturnValue({
      installed: true,
      gatewayRunning: true,
      activeSessions: 1,
      cronJobCount: 2,
      memoryEntries: 7,
      automation: {
        active: true,
        label: 'Automation active',
        enabledJobs: 2,
        totalJobs: 2,
        latestJobId: 'hh-recovery-nightly',
        latestJobName: 'HH recovery nightly',
        latestRunAt: '2026-03-30T09:30:00.000Z',
      },
      hhRecovery: {
        state: 'success',
        label: 'HH recovery completed',
        detail: 'HH recovery completed successfully.',
        jobId: 'hh-recovery-nightly',
        jobName: 'HH recovery nightly',
        lastRunAt: '2026-03-30T09:30:00.000Z',
      },
    })
  })

  it('returns the Hermes runtime summary without write paths', async () => {
    const { GET } = await import('@/app/api/hermes/route')
    const response = await GET(new Request('http://localhost/api/hermes') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.installed).toBe(true)
    expect(payload.gatewayRunning).toBe(true)
    expect(typeof payload.hookInstalled).toBe('boolean')
    expect(payload.automation.label).toBe('Automation active')
    expect(payload.hhRecovery.label).toBe('HH recovery completed')
    expect(mocks.getHermesRuntimeStatusMock).toHaveBeenCalledTimes(1)
    expect(mocks.isHermesInstalledMock).not.toHaveBeenCalled()
  })
})
