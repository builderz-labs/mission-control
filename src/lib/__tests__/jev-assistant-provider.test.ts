import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AuthCallback = (error: Error | null, output: string) => void
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn<(
  file: string, args: string[], options: unknown, callback: AuthCallback,
) => void>() }))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual, spawn: mocks.spawn, execFile: mocks.execFile,
    default: { ...actual, spawn: mocks.spawn, execFile: mocks.execFile },
  }
})

function childProcess() {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  child.stdin = { end: vi.fn() }
  return child
}

function complete(child: EventEmitter & Record<string, unknown>, output: unknown, code = 0) {
  ;(child.stdout as EventEmitter).emit('data', Buffer.from(JSON.stringify(output)))
  child.emit('close', code)
}

const valid = {
  summary: 'Summary', name: 'Policy', description: 'Description',
  questions: { ready: { type: 'noul', instructions: 'Is it ready?' } },
  tests: ['Contract'], risks: ['Missing evidence'], observability: ['Latency'], warnings: [],
}

describe('Jev assistant provider', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    mocks.spawn.mockReset()
    mocks.execFile.mockReset()
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(null, '{"loggedIn":true}'))
    vi.stubEnv('JEV_CLAUDE_BIN', process.execPath)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('uses a no-tools, no-session structured Claude process', async () => {
    const child = childProcess()
    mocks.spawn.mockReturnValue(child)
    const { generateJevAssistantDraft } = await import('@/lib/jev-assistant-provider')
    const generated = generateJevAssistantDraft('safe prompt')
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    complete(child, { is_error: false, structured_output: valid })
    await expect(generated).resolves.toMatchObject({ name: 'Policy' })
    const args = mocks.spawn.mock.calls[0][1] as string[]
    expect(args).toEqual(expect.arrayContaining([
      '--safe-mode', '--restricted', '--disable-slash-commands', '--no-session-persistence',
      '--strict-mcp-config', '--system-prompt', '--json-schema',
    ]))
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    const options = mocks.spawn.mock.calls[0][2]
    expect(options.cwd).toMatch(/mc-jev-assistant-/)
    expect(options.env.XDG_CONFIG_HOME).toBe(`${options.cwd}/.config`)
    expect(options.env.PATH).toBe('/usr/bin:/bin')
    expect(options.env.MAX_THINKING_TOKENS).toBe('1024')
    expect(options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('4096')
    expect(options.env.MAX_STRUCTURED_OUTPUT_RETRIES).toBe('2')
    expect(options.env.CLAUDE_CODE_MAX_RETRIES).toBe('1')
    expect(args[args.indexOf('--system-prompt') + 1]).toContain('do not print a duplicate draft')
    expect(options.detached).toBe(process.platform !== 'win32')
    expect(existsSync(options.cwd)).toBe(false)
  })

  it('does not expose Mission Control secrets to the provider process', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'sentinel-typesafe-secret')
    vi.stubEnv('DOPPLER_TOKEN', 'sentinel-doppler-secret')
    vi.stubEnv('AUTH_SECRET', 'sentinel-auth-secret')
    const child = childProcess()
    mocks.spawn.mockReturnValue(child)
    const { generateJevAssistantDraft } = await import('@/lib/jev-assistant-provider')
    const generated = generateJevAssistantDraft('safe prompt')
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    complete(child, { is_error: false, structured_output: valid })
    await generated
    const options = mocks.spawn.mock.calls[0][2]
    expect(options.env).not.toHaveProperty('TYPESAFE_API_KEY')
    expect(options.env).not.toHaveProperty('DOPPLER_TOKEN')
    expect(options.env).not.toHaveProperty('AUTH_SECRET')
    expect((child.stdin as { end: ReturnType<typeof vi.fn> }).end).toHaveBeenCalledWith('safe prompt')
  })

  it('retries invalid provider output once and returns a safe error', async () => {
    const first = childProcess()
    const second = childProcess()
    mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const { generateJevAssistantDraft } = await import('@/lib/jev-assistant-provider')
    const generated = generateJevAssistantDraft('safe prompt')
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    complete(first, { is_error: false, structured_output: { unsafe: true } })
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2))
    complete(second, { is_error: false, structured_output: { unsafe: true } })
    await expect(generated).rejects.toMatchObject({ code: 'JEV_ASSISTANT_INVALID_OUTPUT' })
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
  })

  it('treats cancellation as terminal and cleans its temporary directory', async () => {
    const child = childProcess()
    mocks.spawn.mockReturnValue(child)
    const controller = new AbortController()
    const { generateJevAssistantDraft } = await import('@/lib/jev-assistant-provider')
    const generated = generateJevAssistantDraft('safe prompt', controller.signal)
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    const cwd = mocks.spawn.mock.calls[0][2].cwd as string
    controller.abort()
    await expect(generated).rejects.toMatchObject({ code: 'JEV_ASSISTANT_CANCELLED' })
    expect(child.kill as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('SIGKILL')
    expect(existsSync(cwd)).toBe(false)
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('does not retry provider rate limits', async () => {
    const child = childProcess()
    mocks.spawn.mockReturnValue(child)
    const { generateJevAssistantDraft } = await import('@/lib/jev-assistant-provider')
    const generated = generateJevAssistantDraft('safe prompt')
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    ;(child.stderr as EventEmitter).emit('data', Buffer.from('rate limit'))
    child.emit('close', 1)
    await expect(generated).rejects.toMatchObject({ code: 'JEV_ASSISTANT_RATE_LIMITED' })
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })

  it('fails safely when the authenticated provider is unavailable', async () => {
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(new Error('unavailable'), ''))
    const { generateJevAssistantDraft } = await import('@/lib/jev-assistant-provider')
    await expect(generateJevAssistantDraft('safe prompt')).rejects.toMatchObject({
      code: 'JEV_ASSISTANT_UNAVAILABLE',
    })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
})
