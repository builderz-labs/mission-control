import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/hermes-sessions', () => ({
  isHermesInstalled: vi.fn(() => false),
  isHermesGatewayRunning: vi.fn(() => false),
  clearHermesDetectionCache: vi.fn(),
  hasHermesCliBinary: vi.fn(() => false),
}))
vi.mock('@/lib/opencode-sessions', () => ({
  isOpenCodeInstalled: vi.fn(() => false),
  getOpenCodeVersion: vi.fn(() => null),
  scanOpenCodeSessions: vi.fn(() => []),
}))
vi.mock('@/lib/zcode-sessions', () => ({
  isZcodeInstalled: vi.fn(() => true),
  getZcodeVersion: vi.fn(() => '0.16.9'),
  scanZcodeSessions: vi.fn(() => [{ isActive: true }]),
  isZcodeAuthenticated: vi.fn(() => true),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/config', () => ({
  config: { openclawConfigPath: '', openclawBin: 'openclaw', gatewayHost: '127.0.0.1', gatewayPort: 18789, homeDir: '/tmp', dataDir: '/tmp' },
}))

import { requireRole } from '@/lib/auth'
import { POST as agentRuntimesPost } from '@/app/api/agent-runtimes/route'
import { detectAllRuntimes, detectRuntime } from '@/lib/agent-runtimes'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { role: 'admin', username: 'tester', workspace_id: 1 } })),
}))

describe('detectRuntime(zcode)', () => {
  it('reports ZCode as installed, running and authenticated from its own probes', () => {
    expect(detectRuntime('zcode')).toMatchObject({
      id: 'zcode',
      name: 'ZCode',
      installed: true,
      version: '0.16.9',
      running: true,
      authRequired: true,
      authenticated: true,
    })
  })

  it('surfaces ZCode in the runtime list the settings UI renders', () => {
    expect(detectAllRuntimes().map((r) => r.id)).toContain('zcode')
  })
})

describe('POST /api/agent-runtimes with runtime=zcode', () => {
  it('accepts zcode as a valid runtime instead of rejecting it as unknown', async () => {
    const response = await agentRuntimesPost(new Request('http://localhost/api/agent-runtimes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'detect', runtime: 'zcode' }),
    }) as any)

    expect(requireRole).toHaveBeenCalled()
    expect(response.status).not.toBe(400)
    expect((await response.json()).status).toMatchObject({ id: 'zcode', installed: true })
  })
})
