/**
 * Per-integration connectivity test functions.
 * Each function performs a network or CLI check and returns { ok, detail }.
 * Called exclusively by handleTest in handlers.ts.
 */
import { execFileSync } from 'child_process'
import { getErrorMessage, toError } from '@/lib/types/sql'
import { detectProviderSubscriptions } from '@/lib/provider-subscriptions'
import { getPluginIntegrations } from '@/lib/plugins'
import type { IntegrationDef } from './types'
import { getEffectiveEnvValue } from './env-store'
import { checkCommandAvailable, resolveOllamaBaseUrl } from './probes'

export type TestResult = { ok: boolean; detail: string }

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Dispatch to the correct per-integration tester, falling back to generic. */
export async function runIntegrationTest(
  integration: IntegrationDef,
  envMap: Map<string, string>,
): Promise<TestResult> {
  const providerSubscriptions = detectProviderSubscriptions()

  switch (integration.id) {
    case 'telegram': return testTelegram(envMap, integration)
    case 'github': return testGithub(envMap)
    case 'anthropic': return testAnthropic(envMap, providerSubscriptions)
    case 'openai': return testOpenai(envMap, providerSubscriptions)
    case 'openrouter': return testApiKey(envMap, 'OPENROUTER_API_KEY', 'https://openrouter.ai/api/v1/models', 'Authorization')
    case 'venice': return testApiKey(envMap, 'VENICE_API_KEY', 'https://api.venice.ai/api/v1/models', 'Authorization')
    case 'hyperbrowser': return testApiKey(envMap, 'HYPERBROWSER_API_KEY', 'https://app.hyperbrowser.ai/api/v2/sessions', 'x-api-key')
    case 'google_workspace': return testGoogleWorkspace(envMap)
    default: return testGenericOrPlugin(integration, envMap)
  }
}

// ---------------------------------------------------------------------------
// Per-integration testers
// ---------------------------------------------------------------------------

async function testTelegram(envMap: Map<string, string>, integration: IntegrationDef): Promise<TestResult> {
  const token = getEffectiveEnvValue(envMap, integration.envVars[0])
  if (!token) return { ok: false, detail: 'Token not set' }
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(5000) })
  const data = await res.json() as { ok: boolean; result?: { username: string }; description?: string }
  return data.ok
    ? { ok: true, detail: `Bot: @${data.result!.username}` }
    : { ok: false, detail: data.description ?? 'Failed' }
}

async function testGithub(envMap: Map<string, string>): Promise<TestResult> {
  const token = getEffectiveEnvValue(envMap, 'GITHUB_TOKEN')
  if (!token) return { ok: false, detail: 'Token not set' }
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'MissionControl/1.0' },
    signal: AbortSignal.timeout(5000),
  })
  return res.ok
    ? { ok: true, detail: `User: ${(await res.json() as { login: string }).login}` }
    : { ok: false, detail: `HTTP ${res.status}` }
}

async function testAnthropic(
  envMap: Map<string, string>,
  providerSubscriptions: ReturnType<typeof detectProviderSubscriptions>,
): Promise<TestResult> {
  const key = getEffectiveEnvValue(envMap, 'ANTHROPIC_API_KEY')
  if (!key) {
    const sub = providerSubscriptions.active.anthropic
    if (sub) return { ok: true, detail: `OAuth/subscription detected: ${sub.type}` }
    return { ok: false, detail: 'API key not set' }
  }
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    signal: AbortSignal.timeout(5000),
  })
  return res.ok ? { ok: true, detail: 'API key valid' } : { ok: false, detail: `HTTP ${res.status}` }
}

async function testOpenai(
  envMap: Map<string, string>,
  providerSubscriptions: ReturnType<typeof detectProviderSubscriptions>,
): Promise<TestResult> {
  const key = getEffectiveEnvValue(envMap, 'OPENAI_API_KEY')
  if (!key) {
    const sub = providerSubscriptions.active.openai
    if (sub) return { ok: true, detail: `OAuth/subscription detected: ${sub.type}` }
    return { ok: false, detail: 'API key not set' }
  }
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5000),
  })
  return res.ok ? { ok: true, detail: 'API key valid' } : { ok: false, detail: `HTTP ${res.status}` }
}

/** Generic API-key tester for integrations whose test is just "does the key work?" */
async function testApiKey(
  envMap: Map<string, string>,
  envKey: string,
  url: string,
  headerName: string,
): Promise<TestResult> {
  const key = getEffectiveEnvValue(envMap, envKey)
  if (!key) return { ok: false, detail: 'API key not set' }
  const headerValue = headerName === 'Authorization' ? `Bearer ${key}` : key
  const res = await fetch(url, { headers: { [headerName]: headerValue }, signal: AbortSignal.timeout(5000) })
  return res.ok ? { ok: true, detail: 'API key valid' } : { ok: false, detail: `HTTP ${res.status}` }
}

async function testGoogleWorkspace(envMap: Map<string, string>): Promise<TestResult> {
  if (!checkCommandAvailable('gws')) {
    return { ok: false, detail: 'gws CLI not installed — run: npm i -g @googleworkspace/cli' }
  }
  try {
    const credsFile = getEffectiveEnvValue(envMap, 'GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE')
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (credsFile) env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE = credsFile
    execFileSync('gws', ['auth', 'status'], { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'], env })
    return { ok: true, detail: 'Authenticated' }
  } catch (err: unknown) {
    const stderr = (toError(err) as NodeJS.ErrnoException & { stderr?: Buffer }).stderr?.toString() ?? ''
    return { ok: false, detail: stderr.slice(0, 120) || 'Not authenticated — run `gws auth login`' }
  }
}

async function testGenericOrPlugin(
  integration: IntegrationDef,
  envMap: Map<string, string>,
): Promise<TestResult> {
  const pluginDef = getPluginIntegrations().find(pi => pi.id === integration.id)
  if (pluginDef?.testHandler) return pluginDef.testHandler(envMap)

  // Generic connectivity test via HEAD request to a known base URL
  const baseUrls: Record<string, string> = {
    nvidia: 'https://api.nvidia.com',
    moonshot: 'https://api.moonshot.cn',
    brave: 'https://api.search.brave.com',
    linkedin: 'https://api.linkedin.com',
    ollama: resolveOllamaBaseUrl(),
    gateway: String(process.env.OPENCLAW_GATEWAY_URL ?? '').trim(),
  }
  const url = baseUrls[integration.id]
  if (!url) {
    return { ok: false, detail: 'No test available — configure the integration URL to enable testing' }
  }
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
  return res.ok || res.status < 500
    ? { ok: true, detail: `Reachable (HTTP ${res.status})` }
    : { ok: false, detail: `Unreachable (HTTP ${res.status})` }
}

// Re-export for convenience (handlers only needs this one symbol from this file)
export { getErrorMessage }
