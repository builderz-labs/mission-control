import { describe, expect, it, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/sessions/continue/route'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => ({ user: { role: 'operator', username: 'tester' } })),
}))

vi.mock('@/lib/command', () => ({
  runCommand: mocks.runCommand,
}))

vi.mock('@/lib/opencode-sessions', () => ({
  getOpenCodeExecutable: vi.fn(() => '/custom/bin/opencode'),
}))

describe('OpenCode session continue route', () => {
  beforeEach(() => {
    mocks.runCommand.mockClear()
  })

  it('invokes the OpenCode CLI with the resume command for kind=opencode', async () => {
    const request = new Request('http://localhost/api/sessions/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'opencode', id: 'ses_open_1', prompt: 'continue' }),
    })
    const response = await POST(request as any)
    expect(response.status).not.toBe(400)
    expect(mocks.runCommand).toHaveBeenCalledWith(
      '/custom/bin/opencode',
      ['run', '--session', 'ses_open_1', 'continue'],
      expect.objectContaining({ timeoutMs: 180000 }),
    )
  })

  it('surfaces OpenCode runtime failures as a 500 error', async () => {
    mocks.runCommand.mockRejectedValueOnce(new Error('Model not found: anthropic/claude-opus-4.5'))

    const request = new Request('http://localhost/api/sessions/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'opencode', id: 'ses_open_1', prompt: 'continue' }),
    })

    const response = await POST(request as any)
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toContain('Model not found')
  })
})
