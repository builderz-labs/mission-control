/**
 * External-tool probes — checks whether CLI tools are installed/authenticated
 * and whether remote endpoints are reachable.
 * Results are cached for INTEGRATION_PROBE_TTL_MS to avoid hammering the OS.
 */
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import os from 'os'
import type { IntegrationProbeSnapshot } from './types'
import { readEnvFile } from './env-store'

// ---------------------------------------------------------------------------
// CLI probes
// ---------------------------------------------------------------------------

/** Uses execFileSync (no shell) to avoid command injection. */
export function checkOpAvailable(): boolean {
  try {
    execFileSync('which', ['op'], { stdio: 'pipe', timeout: 3000 })
    return true
  } catch {
    return false
  }
}

export function checkOpAuthenticated(opEnv?: NodeJS.ProcessEnv): boolean {
  try {
    execFileSync('op', ['whoami', '--format', 'json'], {
      stdio: 'pipe',
      timeout: 3000,
      env: opEnv ?? process.env,
    })
    return true
  } catch {
    return false
  }
}

export function checkCommandAvailable(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'pipe', timeout: 3000 })
    return true
  } catch {
    return false
  }
}

export function checkXintState(): { installed: boolean; oauthConfigured: boolean; envConfigured: boolean } {
  const installed = checkCommandAvailable('xint')
  const oauthPath = join(os.homedir(), '.xint', 'data', 'oauth-tokens.json')
  const envPath = join(os.homedir(), '.xint', '.env')
  return {
    installed,
    oauthConfigured: existsSync(oauthPath),
    envConfigured: existsSync(envPath),
  }
}

// ---------------------------------------------------------------------------
// Ollama reachability
// ---------------------------------------------------------------------------

export function resolveOllamaBaseUrl(): string {
  const raw = String(process.env.OLLAMA_HOST ?? '').trim()
  if (!raw) return 'http://127.0.0.1:11434'
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  return `http://${raw}`
}

export async function checkOllamaReachable(): Promise<boolean> {
  try {
    const base = resolveOllamaBaseUrl().replace(/\/+$/, '')
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1200) })
    return res.ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Probe snapshot (TTL-cached)
// ---------------------------------------------------------------------------

let integrationProbeCache: { ts: number; value: IntegrationProbeSnapshot } | null = null
const INTEGRATION_PROBE_TTL_MS = 5000

export async function getIntegrationProbeSnapshot(): Promise<IntegrationProbeSnapshot> {
  const now = Date.now()
  if (integrationProbeCache && now - integrationProbeCache.ts < INTEGRATION_PROBE_TTL_MS) {
    return integrationProbeCache.value
  }

  const value: IntegrationProbeSnapshot = {
    opAvailable: checkOpAvailable(),
    xint: checkXintState(),
    ollamaInstalled: checkCommandAvailable('ollama'),
    ollamaReachable: await checkOllamaReachable(),
    gwsInstalled: checkCommandAvailable('gws'),
  }
  // Immutable assignment — replace the whole cache object rather than mutating
  integrationProbeCache = { ts: now, value }
  return value
}

// ---------------------------------------------------------------------------
// op CLI environment builder
// ---------------------------------------------------------------------------

/**
 * Build the env object for the op CLI.
 * The OP_SERVICE_ACCOUNT_TOKEN may live in the OpenClaw .env (not the MC .env
 * that systemd loads), so we read it at runtime.
 */
export async function getOpEnv(): Promise<NodeJS.ProcessEnv> {
  const base: NodeJS.ProcessEnv = { ...process.env }
  if (base.OP_SERVICE_ACCOUNT_TOKEN) return base

  const envData = await readEnvFile()
  if (!envData) return base

  for (const line of envData.lines) {
    if (line.type === 'var' && line.key === 'OP_SERVICE_ACCOUNT_TOKEN' && line.value) {
      return { ...base, OP_SERVICE_ACCOUNT_TOKEN: line.value }
    }
  }
  return base
}
