export type FlyAgentRuntime = 'claude' | 'codex'
export type FlySetupProfile = 'none' | 'npm-ci' | 'npm-ci-playwright'

type Metadata = Record<string, unknown>

function value(metadata: Metadata, key: string): string | null {
  const candidate = metadata[key]
  return typeof candidate === 'string' ? candidate.trim() : null
}

function runtime(value: string | null | undefined): FlyAgentRuntime | null {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'claude' || normalized === 'codex' ? normalized : null
}

export function resolveFlyRuntime(agentRuntime: string | null | undefined, metadata: Metadata): FlyAgentRuntime | null {
  const assigned = runtime(agentRuntime)
  const requested = runtime(value(metadata, 'fly_runtime'))
  if (agentRuntime && !assigned) return null
  if (requested && assigned && requested !== assigned) return null
  return requested || assigned || 'codex'
}

export function resolveFlyBaseSha(metadata: Metadata): string | null {
  const sha = value(metadata, 'fly_base_sha')
  return sha && /^[a-f0-9]{40}$/i.test(sha) ? sha.toLowerCase() : null
}

export function resolveFlySetupProfile(metadata: Metadata): FlySetupProfile | null {
  const profile = value(metadata, 'fly_setup') || 'none'
  return profile === 'none' || profile === 'npm-ci' || profile === 'npm-ci-playwright' ? profile : null
}

export function commandForFlyRuntime(runtime: FlyAgentRuntime, env: NodeJS.ProcessEnv = process.env): string {
  if (runtime === 'claude') {
    return env.MC_FLY_CLAUDE_COMMAND || 'claude -p --output-format json --dangerously-skip-permissions --max-turns 40'
  }
  return env.MC_FLY_CODEX_COMMAND || 'codex exec --sandbox workspace-write --skip-git-repo-check -'
}

