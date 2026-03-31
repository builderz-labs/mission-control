import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requireRoleMock = vi.fn()
const runOpenClawMock = vi.fn()
const archiveOrphanTranscriptsForStateDirMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole: requireRoleMock,
}))

vi.mock('@/lib/command', () => ({
  runOpenClaw: runOpenClawMock,
}))

vi.mock('@/lib/config', () => ({
  config: { openclawStateDir: '/tmp/openclaw-state' },
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({ run: vi.fn() })),
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('@/lib/openclaw-doctor-fix', () => ({
  archiveOrphanTranscriptsForStateDir: archiveOrphanTranscriptsForStateDirMock,
}))

describe('GET /api/openclaw/doctor', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    requireRoleMock.mockReset()
    runOpenClawMock.mockReset()
    archiveOrphanTranscriptsForStateDirMock.mockReset()
    archiveOrphanTranscriptsForStateDirMock.mockReturnValue({ archivedOrphans: 0, storesScanned: 0 })
    requireRoleMock.mockReturnValue({ user: { username: 'j2w', workspace_id: 1, role: 'admin' } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('parses stderr advisories even when stdout is non-empty on successful doctor runs', async () => {
    runOpenClawMock.mockResolvedValue({
      code: 0,
      stdout: 'OK: configuration valid',
      stderr: '◇  Gateway service config\n- Gateway service embeds OPENCLAW_GATEWAY_TOKEN and should be reinstalled.\n',
    })

    const { GET } = await import('@/app/api/openclaw/doctor/route')
    const response = await GET(new Request('http://localhost/api/openclaw/doctor?force=1'))
    const payload = await response.json()

    expect(payload.healthy).toBe(true)
    expect(payload.summary).toContain('no blocking issues')
    expect(payload.issues).toEqual([])
  })

  it('returns a visible warm-up status instead of pretending doctor is already healthy', async () => {
    runOpenClawMock.mockImplementation(
      () => new Promise(() => {})
    )

    const { GET } = await import('@/app/api/openclaw/doctor/route')
    const responsePromise = GET(new Request('http://localhost/api/openclaw/doctor'))
    await vi.advanceTimersByTimeAsync(2600)
    const response = await responsePromise
    const payload = await response.json()

    expect(payload.healthy).toBe(false)
    expect(payload.level).toBe('warning')
    expect(payload.summary).toContain('warming up')
  })

  it('skips doctor --fix when the current status is already advisory-only healthy', async () => {
    runOpenClawMock
      .mockResolvedValueOnce({
        code: 0,
        stdout: 'OK: configuration valid',
        stderr: '◇  Gateway service config\n- Gateway service embeds OPENCLAW_GATEWAY_TOKEN and should be reinstalled.\n',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: 'sessions cleanup complete',
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: 'OK: configuration valid',
        stderr: '',
      })

    const { POST } = await import('@/app/api/openclaw/doctor/route')
    const response = await POST(new Request('http://localhost/api/openclaw/doctor', { method: 'POST' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.progress.some((step: { step: string }) => step.step === 'doctor')).toBe(false)
    expect(payload.progress.some((step: { step: string }) => step.step === 'sessions')).toBe(true)
    expect(runOpenClawMock).toHaveBeenCalledTimes(3)
    expect(runOpenClawMock).toHaveBeenNthCalledWith(1, ['doctor'], { timeoutMs: 20000 })
    expect(runOpenClawMock).toHaveBeenNthCalledWith(2, ['sessions', 'cleanup', '--all-agents', '--enforce', '--fix-missing'], { timeoutMs: 120000 })
    expect(runOpenClawMock).toHaveBeenNthCalledWith(3, ['doctor'], { timeoutMs: 20000 })
  })
})
