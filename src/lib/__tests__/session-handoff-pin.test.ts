import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/sessions/handoff/route'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn<(...args: unknown[]) => Promise<{ stdout: string; stderr: string; code: number }>>(),
  requireRole: vi.fn(() => ({ user: { role: 'operator', username: 'tester' } })),
  deny: vi.fn(() => null as unknown),
  pin: vi.fn(async (input: { from: string; to: string }) => ({
    from: input.from,
    to: input.to,
    window: 245400,
    compactRequired: input.to === 'codex',
    env: {},
    unsetEnv: ['CLAUDE_CODE_AUTO_COMPACT_WINDOW'],
    argv: ['-c', 'model_auto_compact_token_limit=245400'],
    policyPath: '/tmp/policy.json',
  })),
}))

vi.mock('@/lib/command', () => ({ runCommand: mocks.runCommand }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/workspace-isolation', () => ({
  denyUnscopedResourceForStrictWorkspace: mocks.deny,
}))
vi.mock('@/lib/rate-limit', () => ({ heavyLimiter: vi.fn(() => null) }))
vi.mock('@/lib/session-transcript-read', () => ({
  readKindTranscript: vi.fn(() => []),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/adaptive-context-handoff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/adaptive-context-handoff')>()),
  pinAdaptiveContext: mocks.pin,
}))

function post(body: Record<string, unknown>) {
  return POST(new NextRequest('http://localhost/api/sessions/handoff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('POST /api/sessions/handoff adaptive-context', () => {
  beforeEach(() => {
    mocks.runCommand.mockReset()
    mocks.runCommand.mockResolvedValue({ stdout: 'ok', stderr: '', code: 0 })
    mocks.pin.mockClear()
  })

  it('pins claude-1 to claude-2 as a new session with the shared window', async () => {
    const res = await post({
      sourceKind: 'claude-code',
      targetKind: 'claude-code',
      sourceAgent: 'claude-20x',
      targetAgent: 'claude-5x',
      sourceId: 'sess-handoff-1',
      excerpt: 'Keep the window',
    })
    const body = await res.json() as { mode: string; fromAgent: string; toAgent: string; window: number }
    expect(body).toMatchObject({
      mode: 'spawn', fromAgent: 'claude-1', toAgent: 'claude-2', window: 245400,
    })
    expect(mocks.pin).toHaveBeenCalledWith(expect.objectContaining({ from: 'claude-1', to: 'claude-2' }))
  })

  it('maps aliases and prepends Codex compact flags', async () => {
    const res = await post({
      sourceKind: 'claude-code',
      targetKind: 'codex-cli',
      sourceAgent: 'claude-2',
      targetAgent: 'codex',
      sourceId: 'sess-handoff-1',
      excerpt: 'go',
    })
    expect(await res.json()).toMatchObject({
      mode: 'spawn', fromAgent: 'claude-2', toAgent: 'codex', compactRequired: true,
    })
    const args = mocks.runCommand.mock.calls.at(0)?.[1] as string[]
    expect(args.slice(0, 3)).toEqual(['-c', 'model_auto_compact_token_limit=245400', 'exec'])
  })
})
