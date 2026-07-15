import { createHash, timingSafeEqual } from 'node:crypto'

export type UserRuntimeTool = 'openclaw' | 'claude' | 'codex'

export interface InstallerDigestResult {
  valid: boolean
  actualSha256: string
}

const EXACT_NPM_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function runtimeInstallsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MC_ENABLE_RUNTIME_INSTALLS === '1'
}

export function isValidInstallerSha256(value: string | undefined): boolean {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim())
}

export function verifyInstallerSha256(content: string | Buffer, expectedSha256: string): InstallerDigestResult {
  const actualSha256 = createHash('sha256').update(content).digest('hex')
  if (!isValidInstallerSha256(expectedSha256)) return { valid: false, actualSha256 }

  const expected = Buffer.from(expectedSha256.trim().toLowerCase(), 'hex')
  const actual = Buffer.from(actualSha256, 'hex')
  return { valid: timingSafeEqual(actual, expected), actualSha256 }
}

export function resolvePinnedUserToolSpec(
  tool: UserRuntimeTool,
  env: Record<string, string | undefined> = process.env,
): { spec: string } | { error: string } {
  if (tool === 'openclaw') {
    const commit = String(env.MC_OPENCLAW_GIT_COMMIT || '').trim().toLowerCase()
    if (!/^[a-f0-9]{40}$/.test(commit)) {
      return { error: 'MC_OPENCLAW_GIT_COMMIT must be a reviewed 40-character commit SHA' }
    }
    return { spec: `github:openclaw/openclaw#${commit}` }
  }

  const envName = tool === 'claude' ? 'MC_CLAUDE_CODE_VERSION' : 'MC_CODEX_VERSION'
  const version = String(env[envName] || '').trim()
  if (!EXACT_NPM_VERSION.test(version)) {
    return { error: `${envName} must be an exact semantic version` }
  }
  const packageName = tool === 'claude' ? '@anthropic-ai/claude-code' : '@openai/codex'
  return { spec: `${packageName}@${version}` }
}
