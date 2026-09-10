import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getDatabaseMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { role: 'viewer', workspace_id: 1 } })),
}))
vi.mock('@/lib/command', () => ({
  runCommand: vi.fn(async () => ({ stdout: '', stderr: '' })),
  runOpenClaw: vi.fn(async () => { throw new Error('no gateway') }),
  runClawdbot: vi.fn(async () => { throw new Error('no gateway') }),
}))
vi.mock('@/lib/config', () => ({
  config: { gatewayHost: '127.0.0.1', gatewayPort: 8080, dbPath: '/tmp/mc.db', dataDir: '/tmp' },
}))
vi.mock('@/lib/db', () => ({ getDatabase: (...args: unknown[]) => getDatabaseMock(...args) }))
vi.mock('@/lib/sessions', () => ({ getAllGatewaySessions: vi.fn(() => []), getAgentLiveStatuses: vi.fn(() => []) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/models', () => ({ MODEL_CATALOG: [] }))
vi.mock('@/lib/hermes-sessions', () => ({ isHermesInstalled: vi.fn(() => false), scanHermesSessions: vi.fn(() => []) }))
vi.mock('@/lib/gateway-runtime', () => ({ registerMcAsDashboard: vi.fn() }))
vi.mock('@/lib/workspace-isolation', () => ({ getWorkspaceIsolation: vi.fn(() => 'shared') }))
vi.mock('@/lib/disk-health', () => ({
  getDiskHealth: vi.fn(async () => ({ usedPercent: 10, availableBytes: 1_000_000_000 })),
}))
vi.mock('@/lib/version', () => ({ APP_VERSION: 'test' }))

describe('GET /api/status?action=health aggregation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks overall status unhealthy when a check is unhealthy', async () => {
    getDatabaseMock.mockImplementation(() => {
      throw new Error('db down')
    })
    const { GET } = await import('@/app/api/status/route')
    const response = await GET(new NextRequest('http://localhost/api/status?action=health'))
    expect(response.status).toBe(503)
    const body = await response.json() as { status: string, checks: Array<{ name: string, status: string }> }
    expect(body.checks.some((check) => check.name === 'Database' && check.status === 'unhealthy')).toBe(true)
    expect(body.status).toBe('unhealthy')
  })
})
