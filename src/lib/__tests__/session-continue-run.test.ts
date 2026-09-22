import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(async () => ({ stdout: 'ok', stderr: '', code: 0 })),
  resolveExecutable: vi.fn(async (name: string) => `/bin/${name}`),
  resolveSessionCwd: vi.fn(async () => '/Users/dev/app'),
}))

vi.mock('@/lib/command', () => ({ runCommand: mocks.runCommand }))
vi.mock('@/lib/session-handoff', () => ({
  resolveExecutable: mocks.resolveExecutable,
  resolveSessionCwd: mocks.resolveSessionCwd,
  shQuote: (value: string) => `'${value}'`,
}))
vi.mock('@/lib/opencode-sessions', () => ({
  getOpenCodeExecutable: () => '/custom/bin/opencode',
}))

import { runSessionContinue } from '../session-continue-run'

describe('runSessionContinue', () => {
  beforeEach(() => {
    mocks.runCommand.mockClear()
    mocks.runCommand.mockResolvedValue({ stdout: 'ok', stderr: '', code: 0 })
  })

  it('sends kimi and opencode prompts on stdin from a home-bound cwd', async () => {
    await runSessionContinue({ kind: 'kimi', sessionId: 'sess-kimi-1', prompt: 'secret prompt', modelId: 'kimi-k2.5' })
    expect(mocks.runCommand).toHaveBeenCalledWith(
      '/bin/kimi',
      ['-S', 'sess-kimi-1', '-p', '-m', 'kimi-k2.5'],
      expect.objectContaining({ input: 'secret prompt', cwd: '/Users/dev/app' }),
    )
    mocks.runCommand.mockClear()
    await runSessionContinue({ kind: 'opencode', sessionId: 'ses_open_1', prompt: 'secret prompt' })
    expect(mocks.runCommand).toHaveBeenCalledWith(
      '/custom/bin/opencode',
      ['run', '--session', 'ses_open_1'],
      expect.objectContaining({ input: 'secret prompt', cwd: '/Users/dev/app' }),
    )
  })

  it('appends bypass flags only when permissionMode is bypass', async () => {
    const dump = () => JSON.stringify(mocks.runCommand.mock.calls)

    await runSessionContinue({
      kind: 'claude-code',
      sessionId: 'sess-claude-1',
      prompt: 'go',
      permissionMode: 'bypass',
    })
    expect(dump()).toContain('--permission-mode')
    expect(dump()).toContain('bypassPermissions')
    expect(dump()).not.toContain('dangerously-skip-permissions')

    mocks.runCommand.mockClear()
    await runSessionContinue({ kind: 'codex-cli', sessionId: 'sess-codex-1', prompt: 'go', permissionMode: 'bypass' })
    expect(dump()).toContain('--sandbox')
    expect(dump()).toContain('danger-full-access')

    mocks.runCommand.mockClear()
    await runSessionContinue({ kind: 'grok', sessionId: 'sess-grok-1', prompt: 'go', permissionMode: 'bypass' })
    expect(dump()).toContain('--always-approve')

    mocks.runCommand.mockClear()
    await runSessionContinue({ kind: 'kimi', sessionId: 'sess-kimi-2', prompt: 'go', permissionMode: 'bypass' })
    expect(dump()).toContain('--auto')

    mocks.runCommand.mockClear()
    await runSessionContinue({ kind: 'claude-code', sessionId: 'sess-claude-2', prompt: 'go' })
    expect(dump()).not.toContain('bypassPermissions')
  })
})
