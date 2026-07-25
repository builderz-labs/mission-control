import { describe, expect, it, vi } from 'vitest'

// The manifests are static declarations; mock the CLI-probing neighbors so
// importing agent-runtimes never spawns anything in the test environment.
vi.mock('@/lib/hermes-sessions', () => ({
  hasHermesCliBinary: vi.fn(() => false),
  clearHermesDetectionCache: vi.fn(),
  isHermesInstalled: vi.fn(() => false),
  isHermesGatewayRunning: vi.fn(() => false),
}))
vi.mock('@/lib/opencode-sessions', () => ({ scanOpenCodeSessions: vi.fn(() => []) }))
vi.mock('@/lib/config', () => ({
  config: { dataDir: '/tmp/mc-test', homeDir: '/tmp/mc-test', workspaceRoot: '/tmp/mc-test' },
  ensureDirExists: vi.fn(),
}))

import {
  RUNTIME_CAPABILITIES,
  getRuntimeCapabilities,
  type RuntimeCapabilities,
  type RuntimeId,
} from '@/lib/agent-runtimes'

const RUNTIME_IDS: RuntimeId[] = ['openclaw', 'hermes', 'claude', 'codex', 'opencode']
const CAPABILITY_KEYS: Array<keyof Omit<RuntimeCapabilities, 'receipts'>> = [
  'dispatch', 'session_resume', 'pty', 'workspace_cwd',
  'tool_policy', 'budget_cap', 'structured_output', 'skills_inventory',
]
const RECEIPT_KEYS = ['diff', 'tests', 'artifact', 'browser', 'telemetry'] as const

describe('runtime capability manifests (#900)', () => {
  it('every runtime declares a complete boolean manifest', () => {
    for (const id of RUNTIME_IDS) {
      const manifest = getRuntimeCapabilities(id)
      expect(manifest, id).toBeDefined()
      for (const key of CAPABILITY_KEYS) {
        expect(typeof manifest[key], `${id}.${key}`).toBe('boolean')
      }
      for (const key of RECEIPT_KEYS) {
        expect(typeof manifest.receipts[key], `${id}.receipts.${key}`).toBe('boolean')
      }
    }
    expect(Object.keys(RUNTIME_CAPABILITIES).sort()).toEqual([...RUNTIME_IDS].sort())
  })

  it('claude declares the shipped truths (#602, #720)', () => {
    const claude = getRuntimeCapabilities('claude')
    expect(claude.dispatch).toBe(true)
    expect(claude.session_resume).toBe(true)
    expect(claude.workspace_cwd).toBe(true)
    expect(claude.tool_policy).toBe(true)
    expect(claude.budget_cap).toBe(true)
    expect(claude.structured_output).toBe(true)
    expect(claude.receipts.telemetry).toBe(true)
    expect(claude.pty).toBe(false)
  })

  it('hermes stays honest until upstream ships machine-readable inventory', () => {
    // Flip only when NousResearch/hermes-agent#71274 lands and the provider
    // from #777 actually consumes it.
    expect(getRuntimeCapabilities('hermes').skills_inventory).toBe(false)
    expect(getRuntimeCapabilities('hermes').dispatch).toBe(false)
  })

  it('read-only scanners never claim dispatch depth', () => {
    expect(getRuntimeCapabilities('opencode').dispatch).toBe(false)
    for (const key of CAPABILITY_KEYS) {
      if (key === 'dispatch') continue
      expect(getRuntimeCapabilities('opencode')[key], `opencode.${key}`).toBe(false)
    }
  })

  it('no adapter claims evidence receipts that nothing produces yet', () => {
    for (const id of RUNTIME_IDS) {
      const receipts = getRuntimeCapabilities(id).receipts
      expect(receipts.diff, `${id}.receipts.diff`).toBe(false)
      expect(receipts.tests, `${id}.receipts.tests`).toBe(false)
      expect(receipts.artifact, `${id}.receipts.artifact`).toBe(false)
      expect(receipts.browser, `${id}.receipts.browser`).toBe(false)
    }
  })
})
