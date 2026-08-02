import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModelConfig } from '@/lib/models'

interface DiscoveredModel extends ModelConfig {
  size?: string
}

interface OpenAiModel {
  id?: string
  object?: string
  owned_by?: string
}

interface OpenAiModelsResponse {
  data?: OpenAiModel[]
}

interface OllamaModelsResponse {
  models?: Array<{ name?: string; size?: number }>
}

interface ProviderDefinition {
  id: string
  displayName: string
  defaultBaseUrl: string
  baseUrlEnv: string[]
  apiKeyEnv?: string[]
}

export const OPENAI_COMPATIBLE_LOCAL_PROVIDERS: ProviderDefinition[] = [
  {
    id: 'supagate',
    displayName: 'SupaGate',
    defaultBaseUrl: 'http://127.0.0.1:8080/v1',
    baseUrlEnv: ['SUPAGATE_BASE_URL', 'SUPAGATE_URL'],
    apiKeyEnv: ['SUPAGATE_API_KEY'],
  },
  {
    id: 'lmstudio',
    displayName: 'LM Studio',
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    baseUrlEnv: ['LMSTUDIO_BASE_URL', 'LM_STUDIO_BASE_URL'],
    apiKeyEnv: ['LMSTUDIO_API_KEY', 'LM_STUDIO_API_KEY'],
  },
  {
    id: 'omlx',
    displayName: 'oMLX',
    defaultBaseUrl: 'http://127.0.0.1:9000/v1',
    baseUrlEnv: ['OMLX_BASE_URL'],
    apiKeyEnv: ['OMLX_API_KEY'],
  },
]

export function resolveOllamaBaseUrl(): string {
  const raw = String(process.env.OLLAMA_HOST || '').trim()
  if (!raw) return 'http://127.0.0.1:11434'
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  return `http://${raw}`
}

function resolveEnvValue(keys: string[] = []): string {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim()
    if (value) return value
  }
  return ''
}

function normalizeOpenAiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function resolveOpenAiModelsUrl(provider: ProviderDefinition): string {
  const baseUrl = normalizeOpenAiBaseUrl(resolveEnvValue(provider.baseUrlEnv) || provider.defaultBaseUrl)
  return `${baseUrl}/models`
}

function readOmlxApiKeyFromSettings(): string {
  const settingsPath = path.join(os.homedir(), '.omlx', 'settings.json')
  if (!existsSync(settingsPath)) return ''

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      api?: { api_key?: unknown }
      auth?: { api_key?: unknown }
    }
    const apiKey = parsed.auth?.api_key ?? parsed.api?.api_key
    return typeof apiKey === 'string' ? apiKey.trim() : ''
  } catch {
    return ''
  }
}

function resolveApiKey(provider: ProviderDefinition): string {
  const fromEnv = resolveEnvValue(provider.apiKeyEnv)
  if (fromEnv) return fromEnv
  if (provider.id === 'omlx') return readOmlxApiKeyFromSettings()
  return ''
}

async function discoverOllamaModels(): Promise<DiscoveredModel[]> {
  const res = await fetch(`${resolveOllamaBaseUrl().replace(/\/+$/, '')}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  })

  if (!res.ok) {
    throw new Error(`Ollama tags endpoint returned ${res.status}`)
  }

  const data = await res.json() as OllamaModelsResponse
  return (data.models || [])
    .filter((model) => typeof model?.name === 'string' && model.name.trim().length > 0)
    .map((model) => {
      const name = model.name!.trim()
      return {
        alias: name,
        name: `ollama/${name}`,
        provider: 'ollama',
        description: 'Local Ollama model',
        costPerMTok: { input: 0, output: 0 },
        size: typeof model.size === 'number' ? String(model.size) : 'unknown',
      }
    })
}

async function discoverOpenAiCompatibleModels(provider: ProviderDefinition): Promise<DiscoveredModel[]> {
  const headers: Record<string, string> = {}
  const apiKey = resolveApiKey(provider)
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const res = await fetch(resolveOpenAiModelsUrl(provider), {
    headers,
    signal: AbortSignal.timeout(5000),
  })

  if (!res.ok) {
    throw new Error(`${provider.displayName} models endpoint returned ${res.status}`)
  }

  const data = await res.json() as OpenAiModelsResponse
  return (data.data || [])
    .filter((model) => typeof model?.id === 'string' && model.id.trim().length > 0)
    .map((model) => {
      const id = model.id!.trim()
      return {
        alias: id,
        name: `${provider.id}/${id}`,
        provider: provider.id,
        description: `Local ${provider.displayName} model`,
        costPerMTok: { input: 0, output: 0 },
      }
    })
}

export async function discoverLocalModels(): Promise<DiscoveredModel[]> {
  const results = await Promise.allSettled([
    discoverOllamaModels(),
    ...OPENAI_COMPATIBLE_LOCAL_PROVIDERS.map(discoverOpenAiCompatibleModels),
  ])

  return results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
}

export async function isLocalProviderReachable(providerId: string): Promise<boolean> {
  try {
    if (providerId === 'ollama') {
      const res = await fetch(`${resolveOllamaBaseUrl().replace(/\/+$/, '')}/api/tags`, {
        signal: AbortSignal.timeout(1200),
      })
      return res.ok
    }

    const provider = OPENAI_COMPATIBLE_LOCAL_PROVIDERS.find((item) => item.id === providerId)
    if (!provider) return false

    const headers: Record<string, string> = {}
    const apiKey = resolveApiKey(provider)
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const res = await fetch(resolveOpenAiModelsUrl(provider), {
      headers,
      signal: AbortSignal.timeout(1200),
    })
    return res.ok
  } catch {
    return false
  }
}
