import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenClawProvider } from '@/lib/execution/providers/openclaw-provider'
import { registerProvider, getProvider, getDefaultProvider, listProviders } from '@/lib/execution/providers/registry'
import type { ExecutionProvider } from '@/lib/execution/providers/types'

vi.mock('@/lib/openclaw-gateway', () => ({
  callOpenClawGateway: vi.fn(),
}))

import { callOpenClawGateway } from '@/lib/openclaw-gateway'
const mockGateway = vi.mocked(callOpenClawGateway)

// ---------------------------------------------------------------------------
// OpenClawProvider
// ---------------------------------------------------------------------------

describe('OpenClawProvider — info', () => {
  it('returns provider info with all capabilities', async () => {
    const provider = new OpenClawProvider()
    const result = await provider.info()
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.data.id).toBe('openclaw')
    expect(result.data.capabilities.spawn).toBe(true)
    expect(result.data.capabilities.kill).toBe(true)
    expect(result.data.capabilities.send).toBe(true)
    expect(result.data.capabilities.transcripts).toBe(true)
  })
})

describe('OpenClawProvider — spawn', () => {
  beforeEach(() => { mockGateway.mockReset() })
  afterEach(() => { vi.restoreAllMocks() })

  it('wraps callOpenClawGateway sessions_spawn and returns ok result', async () => {
    const fakeSession = { sessionId: 'abc-123' }
    mockGateway.mockResolvedValue(fakeSession)

    const provider = new OpenClawProvider()
    const result = await provider.spawn({ task: 'do something', runTimeoutSeconds: 60 })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(result.data).toEqual(fakeSession)
    expect(mockGateway).toHaveBeenCalledWith(
      'sessions_spawn',
      { task: 'do something', runTimeoutSeconds: 60 },
      15_000,
    )
  })

  it('returns structured error when gateway throws — unavailable provider', async () => {
    mockGateway.mockRejectedValue(new Error('gateway not reachable'))

    const provider = new OpenClawProvider()
    const result = await provider.spawn({ task: 'test' })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.error.provider).toBe('openclaw')
    expect(result.error.code).toBe('SPAWN_FAILED')
    expect(result.error.message).toBe('gateway not reachable')
  })

  it('no direct OpenClaw dependency in provider result — result is structured', async () => {
    mockGateway.mockResolvedValue({ session_id: 'x1' })

    const provider = new OpenClawProvider()
    const result = await provider.spawn({ task: 'task' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')
    expect(typeof result.data).toBe('object')
  })
})

describe('OpenClawProvider — kill', () => {
  beforeEach(() => { mockGateway.mockReset() })

  it('wraps sessions_kill and returns ok result', async () => {
    mockGateway.mockResolvedValue({ success: true })

    const provider = new OpenClawProvider()
    const result = await provider.kill('session-key-xyz')

    expect(result.ok).toBe(true)
    expect(mockGateway).toHaveBeenCalledWith('sessions_kill', { sessionKey: 'session-key-xyz' }, 10_000)
  })

  it('returns structured error when kill fails', async () => {
    mockGateway.mockRejectedValue(new Error('kill failed'))

    const provider = new OpenClawProvider()
    const result = await provider.kill('dead-session')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.error.code).toBe('KILL_FAILED')
  })
})

describe('OpenClawProvider — send', () => {
  beforeEach(() => { mockGateway.mockReset() })

  it('wraps sessions_send and returns ok result', async () => {
    mockGateway.mockResolvedValue({ delivered: true })

    const provider = new OpenClawProvider()
    const msg = { type: 'control', action: 'pause' }
    const result = await provider.send('session-abc', msg)

    expect(result.ok).toBe(true)
    expect(mockGateway).toHaveBeenCalledWith('sessions_send', { sessionKey: 'session-abc', message: msg }, 10_000)
  })

  it('returns structured error when send fails', async () => {
    mockGateway.mockRejectedValue(new Error('timeout'))

    const provider = new OpenClawProvider()
    const result = await provider.send('session-abc', {})

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.error.code).toBe('SEND_FAILED')
  })
})

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('ExecutionProvider registry', () => {
  it('default provider is openclaw', () => {
    const provider = getDefaultProvider()
    expect(provider.id).toBe('openclaw')
  })

  it('getProvider with no args returns the default provider', () => {
    const provider = getProvider()
    expect(provider).not.toBeNull()
    expect(provider!.id).toBe('openclaw')
  })

  it('getProvider with id returns the named provider', () => {
    const provider = getProvider('openclaw')
    expect(provider).not.toBeNull()
    expect(provider!.id).toBe('openclaw')
  })

  it('getProvider returns null for unknown id', () => {
    expect(getProvider('nonexistent-provider')).toBeNull()
  })

  it('listProviders includes openclaw', () => {
    expect(listProviders()).toContain('openclaw')
  })

  it('can register a custom provider and retrieve it', () => {
    const testProvider: ExecutionProvider = {
      id: 'test-provider',
      info: async () => ({ ok: true, data: { id: 'test-provider', capabilities: { spawn: false, kill: false, send: false, dispatch: false, transcripts: false } } }),
      spawn: async () => ({ ok: false, error: { provider: 'test-provider', code: 'UNKNOWN', message: 'not implemented' } }),
      kill: async () => ({ ok: false, error: { provider: 'test-provider', code: 'UNKNOWN', message: 'not implemented' } }),
      send: async () => ({ ok: false, error: { provider: 'test-provider', code: 'UNKNOWN', message: 'not implemented' } }),
      dispatch: async () => ({ ok: false, error: { provider: 'test-provider', code: 'DISPATCH_FAILED', message: 'not implemented' } }),
      chatSend: async () => ({ ok: false, error: { provider: 'test-provider', code: 'CHAT_SEND_FAILED', message: 'not implemented' } }),
    }

    registerProvider(testProvider)
    expect(getProvider('test-provider')).toBe(testProvider)
  })

  it('getDefaultProvider throws when registry is empty would not happen since openclaw is always registered', () => {
    const provider = getDefaultProvider()
    expect(provider).toBeDefined()
  })
})
