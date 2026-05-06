import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/hermes-sessions', () => ({
  isHermesInstalled: vi.fn(() => false),
  isHermesGatewayRunning: vi.fn(() => false),
  clearHermesDetectionCache: vi.fn(),
}))

vi.mock('@/lib/opencode-sessions', () => ({
  isOpenCodeInstalled: vi.fn(() => true),
  getOpenCodeVersion: vi.fn(() => '1.4.3'),
  scanOpenCodeSessions: vi.fn(() => [{ isActive: true }]),
}))

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/config', () => ({ config: { openclawConfigPath: '', openclawBin: 'openclaw', gatewayHost: '127.0.0.1', gatewayPort: 18789, homeDir: '/tmp', dataDir: '/tmp' } }))

describe('detectRuntime(opencode)', () => {
  it('reports OpenCode as installed and running when active sessions exist', async () => {
    const { detectRuntime } = await import('@/lib/agent-runtimes')
    const runtime = detectRuntime('opencode')
    expect(runtime).toMatchObject({
      id: 'opencode',
      installed: true,
      version: '1.4.3',
      running: true,
      authenticated: true,
    })
  })
})
