import { describe, it, expect, vi, beforeEach } from 'vitest'

// Must be hoisted so the vi.mock factory can reference these variables.
const { mockRunOpenClaw } = vi.hoisted(() => {
  const mockRunOpenClaw = vi.fn<() => Promise<{ stdout: string; stderr: string; code: number }>>()
  return { mockRunOpenClaw }
})

vi.mock('@/lib/command', () => ({
  runOpenClaw: mockRunOpenClaw,
}))

import { sendSessionMessage } from '@/lib/session-delivery'

describe('sendSessionMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when sessions.send succeeds', async () => {
    mockRunOpenClaw.mockResolvedValue({ stdout: '{"ok":true}', stderr: '', code: 0 })

    const result = await sendSessionMessage('agent:main:main', 'hello')
    expect(result).toBeNull()
    expect(mockRunOpenClaw).toHaveBeenCalledOnce()
    expect(mockRunOpenClaw).toHaveBeenCalledWith(
      ['gateway', 'call', 'sessions.send', '--params',
        JSON.stringify({ session: 'agent:main:main', message: 'hello' })],
      expect.objectContaining({ timeoutMs: 5000 })
    )
  })

  it('returns null (silent no-op) on "unknown method" error — delivery not supported', async () => {
    mockRunOpenClaw.mockRejectedValue(
      Object.assign(new Error('gateway failed'), {
        stderr: 'Gateway call failed: Error: unknown method: sessions.send',
      })
    )

    const start = Date.now()
    const result = await sendSessionMessage('mykey', 'hello', 5000)
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(500)
    expect(result).toBeNull()
  })

  it('returns null (silent no-op) on "unknown command" error', async () => {
    mockRunOpenClaw.mockRejectedValue(
      Object.assign(new Error('gateway failed'), {
        stderr: 'unknown command: sessions.send',
      })
    )

    const result = await sendSessionMessage('mykey', 'hello')
    expect(result).toBeNull()
  })

  it('returns error string when gateway fails with non-definitive error', async () => {
    mockRunOpenClaw.mockRejectedValue(
      Object.assign(new Error('gateway error'), { stderr: 'connection timeout' })
    )

    const result = await sendSessionMessage('mykey', 'hello')
    expect(result).not.toBeNull()
    expect(result).toContain('connection timeout')
  })

  it('passes the correct session key and message to sessions.send', async () => {
    mockRunOpenClaw.mockResolvedValue({ stdout: '{"ok":true}', stderr: '', code: 0 })

    await sendSessionMessage('agent-session-123', 'Test message content')

    expect(mockRunOpenClaw).toHaveBeenCalledWith(
      ['gateway', 'call', 'sessions.send', '--params',
        JSON.stringify({ session: 'agent-session-123', message: 'Test message content' })],
      expect.objectContaining({ timeoutMs: 5000 })
    )
  })

  it('respects a custom timeoutMs value', async () => {
    mockRunOpenClaw.mockResolvedValue({ stdout: '{"ok":true}', stderr: '', code: 0 })

    await sendSessionMessage('key', 'msg', 2000)

    expect(mockRunOpenClaw).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ timeoutMs: 2000 })
    )
  })
})

