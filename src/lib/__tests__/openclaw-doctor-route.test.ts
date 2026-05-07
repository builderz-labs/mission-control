import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mocks must be set up before importing the route module.
const requireRole = vi.fn()
const runOpenClaw = vi.fn()
const archiveOrphanTranscriptsForStateDir = vi.fn()

vi.mock('@/lib/auth', () => ({ requireRole }))
vi.mock('@/lib/command', () => ({ runOpenClaw }))
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare: () => ({ run: vi.fn() }) })),
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/lib/openclaw-doctor-fix', () => ({ archiveOrphanTranscriptsForStateDir }))
vi.mock('@/lib/openclaw-doctor', () => ({
  parseOpenClawDoctorOutput: (out: string, code: number) => ({
    healthy: code === 0,
    level: code === 0 ? 'ok' : 'error',
    issues: [],
    raw: out,
  }),
}))
vi.mock('@/lib/config', () => ({
  config: { openclawStateDir: '/tmp/state' },
}))

const fakeRequest = () => new Request('http://localhost/api/openclaw/doctor')

describe('GET /api/openclaw/doctor — single-flight + TTL cache (issue #613)', () => {
  beforeEach(() => {
    // Reset module state between tests so the in-memory cache starts empty.
    vi.resetModules()
    requireRole.mockReturnValue({ user: { id: 1, username: 'admin', role: 'admin', workspace_id: 1 } })
    runOpenClaw.mockReset()
    // Default TTL — long enough that the cache hit test is reliable.
    process.env.MC_DOCTOR_TTL_MS = '30000'
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('coalesces concurrent GETs into a single subprocess invocation', async () => {
    runOpenClaw.mockImplementation(async () => {
      // Simulate the doctor subprocess taking some time.
      await new Promise(resolve => setTimeout(resolve, 20))
      return { stdout: 'all good', stderr: '', code: 0 }
    })

    const { GET } = await import('@/app/api/openclaw/doctor/route')

    const responses = await Promise.all([
      GET(fakeRequest()),
      GET(fakeRequest()),
      GET(fakeRequest()),
      GET(fakeRequest()),
      GET(fakeRequest()),
    ])

    expect(runOpenClaw).toHaveBeenCalledTimes(1)
    expect(responses).toHaveLength(5)
    for (const res of responses) {
      expect(res.status).toBe(200)
    }
  })

  it('serves cached response within TTL without re-running the subprocess', async () => {
    runOpenClaw.mockResolvedValue({ stdout: 'all good', stderr: '', code: 0 })

    const { GET } = await import('@/app/api/openclaw/doctor/route')

    const first = await GET(fakeRequest())
    expect(runOpenClaw).toHaveBeenCalledTimes(1)
    expect(first.headers.get('X-Doctor-Cache')).toBe('miss')

    const second = await GET(fakeRequest())
    expect(runOpenClaw).toHaveBeenCalledTimes(1) // still 1 — cache hit
    expect(second.headers.get('X-Doctor-Cache')).toBe('hit')
  })

  it('re-runs the subprocess after the TTL expires', async () => {
    process.env.MC_DOCTOR_TTL_MS = '0' // expire immediately
    runOpenClaw.mockResolvedValue({ stdout: 'all good', stderr: '', code: 0 })

    const { GET } = await import('@/app/api/openclaw/doctor/route')

    await GET(fakeRequest())
    await GET(fakeRequest())
    expect(runOpenClaw).toHaveBeenCalledTimes(2)
  })

  it('does not cache "not installed" — next poll re-attempts immediately', async () => {
    runOpenClaw.mockRejectedValue(Object.assign(new Error('spawn openclaw ENOENT'), { code: 'ENOENT' }))

    const { GET } = await import('@/app/api/openclaw/doctor/route')

    const first = await GET(fakeRequest())
    expect(first.status).toBe(400)
    expect(runOpenClaw).toHaveBeenCalledTimes(1)

    const second = await GET(fakeRequest())
    expect(second.status).toBe(400)
    // Both calls invoked the subprocess — operator may install OpenClaw mid-session.
    expect(runOpenClaw).toHaveBeenCalledTimes(2)
  })

  it('rejects unauthenticated requests before invoking the subprocess', async () => {
    requireRole.mockReturnValue({ error: 'Unauthorized', status: 401 })

    const { GET } = await import('@/app/api/openclaw/doctor/route')

    const res = await GET(fakeRequest())
    expect(res.status).toBe(401)
    expect(runOpenClaw).not.toHaveBeenCalled()
  })

  it('exposes invalidateDoctorCache so POST /--fix can invalidate', async () => {
    runOpenClaw.mockResolvedValue({ stdout: 'all good', stderr: '', code: 0 })

    const route = await import('@/app/api/openclaw/doctor/route')
    expect(typeof route.invalidateDoctorCache).toBe('function')

    await route.GET(fakeRequest())
    expect(runOpenClaw).toHaveBeenCalledTimes(1)

    // Sanity: cached
    await route.GET(fakeRequest())
    expect(runOpenClaw).toHaveBeenCalledTimes(1)

    // Invalidate: next GET should re-run.
    route.invalidateDoctorCache()
    await route.GET(fakeRequest())
    expect(runOpenClaw).toHaveBeenCalledTimes(2)
  })
})
