import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AuthCallback = (error: Error | null, output: string) => void
const exec = vi.hoisted(() => vi.fn<(
  file: string, args: string[], options: { cwd: string; timeout: number; env: Record<string, string> }, callback: AuthCallback,
) => void>())
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, execFile: exec, default: { ...actual, execFile: exec } }
})

describe('Jev assistant readiness', () => {
  beforeEach(() => {
    vi.resetModules(); exec.mockReset()
    vi.stubEnv('JEV_CLAUDE_BIN', process.execPath)
    exec.mockImplementation((_file, _args, _options, callback) => callback(null, '{"loggedIn":true}'))
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('retries a cold-start timeout once, caches success and cleans the isolated directory', async () => {
    exec.mockImplementationOnce((_file, _args, _options, callback) => callback(new Error('timeout'), ''))
    const { isJevAssistantAvailable } = await import('@/lib/jev-assistant-provider')
    expect(await isJevAssistantAvailable()).toBe(true)
    expect(await isJevAssistantAvailable()).toBe(true)
    expect(exec).toHaveBeenCalledTimes(2)
    expect(exec.mock.calls[0][2]).toMatchObject({ timeout: 5000, maxBuffer: 64000, killSignal: 'SIGKILL' })
    expect(existsSync(exec.mock.calls[0][2].cwd)).toBe(false)
  })

  it('shares an in-flight probe without blocking the event loop or spawning duplicates', async () => {
    let complete: AuthCallback | undefined
    exec.mockImplementation((_file, _args, _options, callback) => { complete = callback })
    const { isJevAssistantAvailable } = await import('@/lib/jev-assistant-provider')
    const first = isJevAssistantAvailable(); const second = isJevAssistantAvailable()
    expect(exec).toHaveBeenCalledOnce()
    expect(complete).toBeDefined()
    complete?.(null, '{"loggedIn":true}')
    expect(await Promise.all([first, second])).toEqual([true, true])
  })

  it('never treats malformed or failed auth probes as a connected provider', async () => {
    exec.mockImplementation((_file, _args, _options, callback) => callback(null, '{"unexpected":true}'))
    const { isJevAssistantAvailable } = await import('@/lib/jev-assistant-provider')
    expect(await isJevAssistantAvailable()).toBe(false)
    expect(exec).toHaveBeenCalledTimes(2)
    expect(existsSync(exec.mock.calls[0][2].cwd)).toBe(false)
  })

  it('keeps credential failures fail-closed and rechecks after the short negative cache', async () => {
    const time = vi.spyOn(Date, 'now').mockReturnValue(100_000)
    exec.mockImplementation((_file, _args, _options, callback) => callback(null, '{"loggedIn":false}'))
    const { isJevAssistantAvailable } = await import('@/lib/jev-assistant-provider')
    expect(await isJevAssistantAvailable()).toBe(false)
    expect(await isJevAssistantAvailable()).toBe(false)
    expect(exec).toHaveBeenCalledOnce()
    time.mockReturnValue(116_000)
    exec.mockImplementation((_file, _args, _options, callback) => callback(null, '{"loggedIn":true}'))
    expect(await isJevAssistantAvailable()).toBe(true)
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('does not expose unrelated application secrets to the auth probe', async () => {
    vi.stubEnv('DOPPLER_TOKEN', 'sentinel-doppler-secret')
    vi.stubEnv('TYPESAFE_API_KEY', 'sentinel-typesafe-secret')
    const { isJevAssistantAvailable } = await import('@/lib/jev-assistant-provider')
    expect(await isJevAssistantAvailable()).toBe(true)
    expect(exec.mock.calls[0][2].env).not.toHaveProperty('DOPPLER_TOKEN')
    expect(exec.mock.calls[0][2].env).not.toHaveProperty('TYPESAFE_API_KEY')
  })
})
