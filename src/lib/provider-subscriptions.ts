import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { config } from '@/lib/config'
import { classifyModelProvider } from '@/lib/models'

interface ProviderSubscription {
  provider: string
  type: string
  source: 'env' | 'file'
}

interface SubscriptionDetectionResult {
  active: Record<string, ProviderSubscription>
}

const NEGATIVE_TYPES = new Set(['none', 'no', 'false', 'free', 'unknown', 'api_key', 'apikey'])

const OPENAI_CREDENTIAL_PATHS = [
  path.join(os.homedir(), '.config', 'openai', 'auth.json'),
  path.join(os.homedir(), '.openai', 'auth.json'),
  path.join(os.homedir(), '.codex', 'auth.json'),
]

let detectionCache: { ts: number; value: SubscriptionDetectionResult } | null = null
const CACHE_TTL_MS = 30_000

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase()
}

function normalizeType(value: string): string {
  return value.trim().toLowerCase()
}

function isPositiveSubscription(type: string): boolean {
  if (!type) return false
  return !NEGATIVE_TYPES.has(normalizeType(type))
}

function parseJsonFile(filePath: string): unknown | null {
  try {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function findNestedString(root: unknown, keys: string[]): string | null {
  const queue: unknown[] = [root]
  const wanted = new Set(keys.map(k => k.toLowerCase()))

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item)
      continue
    }

    for (const [rawKey, value] of Object.entries(current)) {
      const key = rawKey.toLowerCase()
      if (wanted.has(key) && typeof value === 'string' && value.trim()) {
        return value.trim()
      }
      if (value && typeof value === 'object') queue.push(value)
    }
  }

  return null
}

function detectAnthropicFromFile(): ProviderSubscription | null {
  // Try credentials file first (legacy Claude Code 1.x)
  const credsPath = path.join(config.claudeHome, '.credentials.json')
  const creds = parseJsonFile(credsPath) as Record<string, unknown> | null
  if (creds && typeof creds === 'object') {
    const oauth = creds.claudeAiOauth as Record<string, unknown> | undefined
    const subscriptionType = typeof oauth?.subscriptionType === 'string' ? oauth.subscriptionType : ''
    if (isPositiveSubscription(subscriptionType)) {
      return { provider: 'anthropic', type: normalizeType(subscriptionType), source: 'file' }
    }
  }

  // Fallback: Claude Code 2.x stores OAuth in keychain — use CLI to query
  try {
    const raw = execFileSync('claude', ['auth', 'status'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: os.homedir() },
    })
    const status = JSON.parse(raw.trim())
    const subType = typeof status?.subscriptionType === 'string' ? status.subscriptionType : ''
    if (isPositiveSubscription(subType)) {
      return { provider: 'anthropic', type: normalizeType(subType), source: 'file' }
    }
  } catch {
    // claude CLI not available or auth check failed
  }

  return null
}

function detectOpenAIFromFile(): ProviderSubscription | null {
  for (const credsPath of OPENAI_CREDENTIAL_PATHS) {
    const creds = parseJsonFile(credsPath) as Record<string, unknown> | null
    if (!creds) continue

    // Codex stores auth_mode: "chatgpt" to indicate ChatGPT subscription auth
    const authMode = typeof creds.auth_mode === 'string' ? creds.auth_mode : ''
    if (authMode === 'chatgpt') {
      return { provider: 'openai', type: 'chatgpt', source: 'file' }
    }

    const plan = findNestedString(creds, [
      'subscriptionType',
      'subscription_type',
      'accountPlan',
      'account_plan',
      'plan',
      'tier',
    ])
    if (!plan || !isPositiveSubscription(plan)) continue
    return {
      provider: 'openai',
      type: normalizeType(plan),
      source: 'file',
    }
  }
  return null
}

function detectFromEnv(): Record<string, ProviderSubscription> {
  const active: Record<string, ProviderSubscription> = {}

  const allProvidersRaw = process.env.MC_SUBSCRIBED_PROVIDERS || ''
  if (allProvidersRaw.trim()) {
    for (const raw of allProvidersRaw.split(',')) {
      const provider = normalizeProvider(raw)
      if (!provider) continue
      active[provider] = {
        provider,
        type: 'subscription',
        source: 'env',
      }
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue

    const explicitMatch = key.match(/^MC_([A-Z0-9_]+)_SUBSCRIPTION(?:_TYPE)?$/)
    if (explicitMatch) {
      const provider = normalizeProvider(explicitMatch[1].replace(/_/g, '-'))
      const type = normalizeType(value)
      if (isPositiveSubscription(type)) {
        active[provider] = { provider, type, source: 'env' }
      } else {
        delete active[provider]
      }
      continue
    }

    const providerMatch = key.match(/^([A-Z0-9_]+)_SUBSCRIPTION_TYPE$/)
    if (providerMatch) {
      const provider = normalizeProvider(providerMatch[1].replace(/_/g, '-'))
      const type = normalizeType(value)
      if (isPositiveSubscription(type)) {
        active[provider] = { provider, type, source: 'env' }
      } else {
        delete active[provider]
      }
    }
  }

  return active
}

export function detectProviderSubscriptions(forceRefresh = false): SubscriptionDetectionResult {
  const now = Date.now()
  if (!forceRefresh && detectionCache && (now - detectionCache.ts) < CACHE_TTL_MS) {
    return detectionCache.value
  }

  const active = detectFromEnv()

  const anthropic = detectAnthropicFromFile()
  if (anthropic) active.anthropic = anthropic

  const openai = detectOpenAIFromFile()
  if (openai) active.openai = openai

  const value = { active }
  detectionCache = { ts: now, value }
  return value
}

export function getProviderSubscriptionFlags(forceRefresh = false): Record<string, boolean> {
  const detected = detectProviderSubscriptions(forceRefresh)
  return Object.fromEntries(
    Object.keys(detected.active).map((provider) => [provider, true])
  )
}

export function getPrimarySubscription(forceRefresh = false): ProviderSubscription | null {
  const detected = detectProviderSubscriptions(forceRefresh).active
  return detected.anthropic || detected.openai || Object.values(detected)[0] || null
}

export function getProviderFromModel(modelName: string): string {
  const normalized = modelName.trim().toLowerCase()
  if (!normalized) return 'unknown'

  const catalogProvider = classifyModelProvider(normalized)
  if (catalogProvider) return catalogProvider

  const [prefix] = normalized.split('/')
  if (prefix && !prefix.includes(':')) {
    // Most models are provider-prefixed, e.g., "anthropic/claude-sonnet-4-5".
    if (prefix === 'claude') return 'anthropic'
    if (prefix === 'gpt' || prefix === 'o1' || prefix === 'o3') return 'openai'
    return prefix
  }

  if (normalized.includes('claude')) return 'anthropic'
  if (normalized.includes('gpt') || normalized.includes('codex') || normalized.includes('o1') || normalized.includes('o3')) return 'openai'
  return 'unknown'
}
