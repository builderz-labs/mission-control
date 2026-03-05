import { describe, it, expect, vi, beforeEach } from 'vitest'

// Must be hoisted so the vi.mock factory can reference these variables.
const { mockRunClawdbot, mockRunOpenClaw } = vi.hoisted(() => {
  const mockRunClawdbot = vi.fn<() => Promise<{ stdout: string; stderr: string; code: number }>>()
  const mockRunOpenClaw = vi.fn<() => Promise<{ stdout: string; stderr: string; code: number }>>()
  return { mockRunClawdbot, mockRunOpenClaw }
})

vi.mock('@/lib/command', () => ({
  runClawdbot: mockRunClawdbot,
  runOpenClaw: mockRunOpenClaw,
}))

import { sendSessionMessage } from '@/lib/session-delivery'

// Helper: create a promise that resolves after `ms` milliseconds.
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

describe('sendSessionMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when clawdbot succeeds', async () => {
    mockRunClawdbot.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    // Gateway is never needed; but it will also be started in parallel — make it hang
    mockRunOpenClaw.mockReturnValue(new Promise(() => {/* never resolves */}))

    const result = await sendSessionMessage('mykey', 'hello')
    expect(result).toBeNull()
    expect(mockRunClawdbot).toHaveBeenCalledOnce()
  })

  it('returns null when gateway succeeds even though clawdbot fails', async () => {
    mockRunClawdbot.mockRejectedValue(new Error('clawdbot not found'))
    mockRunOpenClaw.mockResolvedValue({ stdout: '', stderr: '', code: 0 })

    const result = await sendSessionMessage('mykey', 'hello')
    expect(result).toBeNull()
  })

  it('short-circuits immediately on "unknown method" gateway error without waiting for clawdbot', async () => {
    // clawdbot never resolves (simulates hanging daemon wait)
    let clawdbotKilled = false
    mockRunClawdbot.mockReturnValue(
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          clawdbotKilled = true
          reject(new Error('Command timed out after 5000ms'))
        }, 5000)
      )
    )
    // Gateway fails immediately with "unknown method"
    mockRunOpenClaw.mockRejectedValue(
      Object.assign(new Error('gateway failed'), {
        stderr: 'Gateway call failed: Error: unknown method: sessions.send',
      })
    )

    const start = Date.now()
    const result = await sendSessionMessage('mykey', 'hello', 5000)
    const elapsed = Date.now() - start

    // Should resolve almost immediately (well under 500 ms), not wait 5 s for clawdbot
    expect(elapsed).toBeLessThan(500)
    expect(result).not.toBeNull()
    expect(result).toContain('unknown method')
    // clawdbot was NOT awaited (still pending at this point)
    expect(clawdbotKilled).toBe(false)
  })

  it('short-circuits immediately on "unknown command" gateway error', async () => {
    mockRunClawdbot.mockReturnValue(new Promise(() => {/* never resolves */}))
    mockRunOpenClaw.mockRejectedValue(
      Object.assign(new Error('gateway failed'), {
        stderr: 'unknown command: sessions.send',
      })
    )

    const start = Date.now()
    const result = await sendSessionMessage('mykey', 'hello', 5000)
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(500)
    expect(result).not.toBeNull()
  })

  it('returns combined error string when both methods fail with non-definitive errors', async () => {
    mockRunClawdbot.mockRejectedValue(new Error('clawdbot connection refused'))
    mockRunOpenClaw.mockRejectedValue(
      Object.assign(new Error('gateway error'), { stderr: 'connection timeout' })
    )

    const result = await sendSessionMessage('mykey', 'hello')
    expect(result).not.toBeNull()
    expect(result).toContain('clawdbot connection refused')
    expect(result).toContain('connection timeout')
  })

  it('passes the correct session key and message to both runners', async () => {
    mockRunClawdbot.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    mockRunOpenClaw.mockReturnValue(new Promise(() => {/* never resolves */}))

    await sendSessionMessage('agent-session-123', 'Test message content')

    expect(mockRunClawdbot).toHaveBeenCalledWith(
      ['sessions_send', 'agent-session-123', 'Test message content'],
      expect.objectContaining({ timeoutMs: 5000 })
    )
    expect(mockRunOpenClaw).toHaveBeenCalledWith(
      ['gateway', 'call', 'sessions.send', '--params', JSON.stringify({ session: 'agent-session-123', message: 'Test message content' })],
      expect.objectContaining({ timeoutMs: 5000 })
    )
  })

  it('respects a custom timeoutMs value', async () => {
    mockRunClawdbot.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    mockRunOpenClaw.mockReturnValue(new Promise(() => {/* never resolves */}))

    await sendSessionMessage('key', 'msg', 2000)

    expect(mockRunClawdbot).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ timeoutMs: 2000 })
    )
    expect(mockRunOpenClaw).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ timeoutMs: 2000 })
    )
  })
})
