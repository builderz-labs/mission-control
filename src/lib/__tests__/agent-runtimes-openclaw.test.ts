import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/hermes-sessions', () => ({
  isHermesInstalled: vi.fn(() => false),
  isHermesGatewayRunning: vi.fn(() => false),
  clearHermesDetectionCache: vi.fn(),
}))

vi.mock('@/lib/opencode-sessions', () => ({
  isOpenCodeInstalled: vi.fn(() => false),
  getOpenCodeVersion: vi.fn(() => null),
  scanOpenCodeSessions: vi.fn(() => []),
}))

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/config', () => ({
  config: {
    openclawConfigPath: '/tmp/does-not-exist-openclaw.json',
    openclawBin: 'openclaw-missing-binary',
    gatewayHost: '127.0.0.1',
    gatewayPort: 18789,
    homeDir: '/tmp',
    dataDir: '/tmp',
  },
}))

describe('detectRuntime(openclaw)', () => {
  it('does not report a running gateway when the binary is missing', async () => {
    const { detectRuntime } = await import('@/lib/agent-runtimes')
    const runtime = detectRuntime('openclaw')
    expect(runtime.running).toBe(false)
    expect(runtime.authenticated).toBe(false)
  })
})
