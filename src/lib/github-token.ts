import { spawnSync } from 'node:child_process'
import { getEffectiveEnvValue } from '@/lib/runtime-env'

const GH_TIMEOUT_MS = 8000

function readGhAuthToken(): string | null {
  try {
    const result = spawnSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      timeout: GH_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (result.status !== 0) return null
    const token = (result.stdout || '').trim()
    if (!token || /\s/.test(token)) return null
    return token
  } catch {
    return null
  }
}

export async function getGitHubToken(): Promise<string | null> {
  const fromEnv = (await getEffectiveEnvValue('GITHUB_TOKEN'))?.trim()
  if (fromEnv) return fromEnv
  return readGhAuthToken() || readGhAuthToken()
}
