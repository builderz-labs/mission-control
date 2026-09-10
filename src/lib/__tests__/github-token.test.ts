import { afterEach, describe, expect, it, vi } from 'vitest'

const getEffectiveEnvValue = vi.fn<(key: string) => Promise<string | null>>()
const spawnSync = vi.fn<(...args: unknown[]) => unknown>()

vi.mock('@/lib/runtime-env', () => ({
  getEffectiveEnvValue: (key: string) => getEffectiveEnvValue(key),
}))

vi.mock('node:child_process', () => {
  const spawnSyncMock = (...args: unknown[]) => spawnSync(...args)
  return {
    spawnSync: spawnSyncMock,
    default: { spawnSync: spawnSyncMock },
  }
})

describe('getGitHubToken', () => {
  afterEach(() => {
    getEffectiveEnvValue.mockReset()
    spawnSync.mockReset()
  })

  it('prefers GITHUB_TOKEN from the effective env', async () => {
    getEffectiveEnvValue.mockResolvedValueOnce('env-token')
    const { getGitHubToken } = await import('@/lib/github-token')
    await expect(getGitHubToken()).resolves.toBe('env-token')
    expect(spawnSync).not.toHaveBeenCalled()
  })

  it('falls back to gh auth token with one retry', async () => {
    getEffectiveEnvValue.mockResolvedValue(null)
    spawnSync
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'transient' })
      .mockReturnValueOnce({ status: 0, stdout: 'ghp_fromcli\n', stderr: '' })
    vi.resetModules()
    const { getGitHubToken } = await import('@/lib/github-token')
    await expect(getGitHubToken()).resolves.toBe('ghp_fromcli')
    expect(spawnSync).toHaveBeenCalledTimes(2)
    expect(spawnSync).toHaveBeenCalledWith(
      'gh',
      ['auth', 'token'],
      expect.objectContaining({ timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] }),
    )
  })

  it('returns null when gh is missing', async () => {
    getEffectiveEnvValue.mockResolvedValue(null)
    spawnSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    vi.resetModules()
    const { getGitHubToken } = await import('@/lib/github-token')
    await expect(getGitHubToken()).resolves.toBeNull()
  })
})
