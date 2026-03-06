import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks (must precede any imports that use them) ──────────────────
const { mockRunOpenClaw, mockRunCommand, mockLogger } = vi.hoisted(() => {
  const mockRunOpenClaw = vi.fn<() => Promise<{ stdout: string; stderr: string; code: number }>>()
  const mockRunCommand = vi.fn<() => Promise<{ stdout: string; stderr: string; code: number }>>()
  const mockLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }
  return { mockRunOpenClaw, mockRunCommand, mockLogger }
})

vi.mock('@/lib/command', () => ({
  runOpenClaw: mockRunOpenClaw,
  runCommand: mockRunCommand,
  runClawdbot: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({
    user: { id: 1, workspace_id: 1, role: 'admin' },
  })),
}))

vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => null),
      run: vi.fn(),
    })),
  })),
}))

vi.mock('@/lib/sessions', () => ({
  getAllGatewaySessions: vi.fn(() => []),
  getAgentLiveStatuses: vi.fn(() => ({})),
}))

vi.mock('@/lib/provider-subscriptions', () => ({
  detectProviderSubscriptions: vi.fn(() => ({})),
  getPrimarySubscription: vi.fn(() => null),
}))

import { GET } from './route'
import { MODEL_CATALOG } from '@/lib/models'

function makeRequest(action: string) {
  return new NextRequest(`http://localhost/api/status?action=${action}`)
}

describe('GET /api/status?action=models — model fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: ollama not available
    mockRunCommand.mockRejectedValue(new Error('ollama: command not found'))
  })

  it('returns static catalog when runOpenClaw resolves with non-JSON stdout (gateway offline message)', async () => {
    // Simulate: openclaw gateway call models.list exits 0 but writes a plain-text error
    mockRunOpenClaw.mockResolvedValue({
      stdout: 'Gateway cannot be reached: connection refused',
      stderr: '',
      code: 0,
    })

    const res = await GET(makeRequest('models'))
    const body = await res.json()

    // Should fall back to static catalog without throwing
    expect(body.models).toBeDefined()
    expect(body.models.length).toBeGreaterThanOrEqual(MODEL_CATALOG.length)

    // Should log a warn, NOT an error
    expect(mockLogger.warn).toHaveBeenCalled()
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('returns static catalog when runOpenClaw resolves with empty stdout', async () => {
    mockRunOpenClaw.mockResolvedValue({ stdout: '', stderr: '', code: 0 })

    const res = await GET(makeRequest('models'))
    const body = await res.json()

    expect(body.models.length).toBeGreaterThanOrEqual(MODEL_CATALOG.length)
    // Empty stdout: completely silent — no warn or error logged for models.list
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ output: expect.any(String) }),
      expect.stringContaining('models.list')
    )
  })

  it('merges remote models from valid JSON stdout into the catalog', async () => {
    const remoteModels = [
      { name: 'openai/gpt-4o', provider: 'openai', description: 'GPT-4o', costPer1k: 5.0 },
    ]
    mockRunOpenClaw.mockResolvedValue({
      stdout: JSON.stringify({ models: remoteModels }),
      stderr: '',
      code: 0,
    })

    const res = await GET(makeRequest('models'))
    const body = await res.json()

    const names = body.models.map((m: { name: string }) => m.name)
    expect(names).toContain('openai/gpt-4o')
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('falls back to static catalog when runOpenClaw rejects (command unavailable)', async () => {
    mockRunOpenClaw.mockRejectedValue(new Error('openclaw: command not found'))

    const res = await GET(makeRequest('models'))
    const body = await res.json()

    expect(body.models.length).toBeGreaterThanOrEqual(MODEL_CATALOG.length)
    expect(mockLogger.warn).toHaveBeenCalled()
    expect(mockLogger.error).not.toHaveBeenCalled()
  })
})
