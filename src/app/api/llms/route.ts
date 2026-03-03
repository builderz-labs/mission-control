import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

interface LLMModel {
  id: string
  name: string
  provider: string
  size?: string
  quantization?: string
  family?: string
  parameters?: string
  format?: string
  modifiedAt?: string
}

interface LLMProvider {
  id: string
  name: string
  type: 'local' | 'remote'
  endpoint: string
  status: 'online' | 'offline' | 'unknown'
  models: LLMModel[]
}

/**
 * GET /api/llms — Discover available LLMs from configured providers
 * Query params: ?refresh=true to force re-fetch
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const providers: LLMProvider[] = []

  // 1. Ollama
  const ollamaHost = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'
  try {
    const res = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      const data = await res.json()
      const models: LLMModel[] = (data.models || []).map((m: any) => {
        const parts = (m.name || '').split(':')
        return {
          id: m.name || m.model,
          name: parts[0],
          provider: 'ollama',
          size: m.size ? formatBytes(m.size) : undefined,
          quantization: parts[1] || undefined,
          family: m.details?.family,
          parameters: m.details?.parameter_size,
          format: m.details?.format,
          modifiedAt: m.modified_at,
        }
      })
      providers.push({
        id: 'ollama',
        name: 'Ollama',
        type: 'local',
        endpoint: ollamaHost,
        status: 'online',
        models,
      })
    } else {
      providers.push({ id: 'ollama', name: 'Ollama', type: 'local', endpoint: ollamaHost, status: 'offline', models: [] })
    }
  } catch {
    providers.push({ id: 'ollama', name: 'Ollama', type: 'local', endpoint: ollamaHost, status: 'offline', models: [] })
  }

  // 2. LM Studio (compatible with OpenAI API)
  const lmStudioHost = process.env.LM_STUDIO_HOST || 'http://127.0.0.1:1234'
  try {
    const res = await fetch(`${lmStudioHost}/v1/models`, { signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      const data = await res.json()
      const models: LLMModel[] = (data.data || []).map((m: any) => ({
        id: m.id,
        name: m.id,
        provider: 'lm-studio',
        size: undefined,
        family: m.owned_by || undefined,
      }))
      providers.push({
        id: 'lm-studio',
        name: 'LM Studio',
        type: 'local',
        endpoint: lmStudioHost,
        status: 'online',
        models,
      })
    } else {
      providers.push({ id: 'lm-studio', name: 'LM Studio', type: 'local', endpoint: lmStudioHost, status: 'offline', models: [] })
    }
  } catch {
    providers.push({ id: 'lm-studio', name: 'LM Studio', type: 'local', endpoint: lmStudioHost, status: 'offline', models: [] })
  }

  // 3. OpenAI-compatible (if API key configured)
  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const data = await res.json()
        const models: LLMModel[] = (data.data || [])
          .filter((m: any) => m.id.startsWith('gpt-') || m.id.startsWith('o'))
          .map((m: any) => ({
            id: m.id,
            name: m.id,
            provider: 'openai',
            family: m.owned_by || 'openai',
          }))
        providers.push({
          id: 'openai',
          name: 'OpenAI',
          type: 'remote',
          endpoint: 'https://api.openai.com',
          status: 'online',
          models,
        })
      }
    } catch {
      providers.push({ id: 'openai', name: 'OpenAI', type: 'remote', endpoint: 'https://api.openai.com', status: 'offline', models: [] })
    }
  }

  // 4. Anthropic (if API key configured)
  if (process.env.ANTHROPIC_API_KEY) {
    // Anthropic doesn't have a list models endpoint; provide known models
    const anthropicModels: LLMModel[] = [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', family: 'claude' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', family: 'claude' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', family: 'claude' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic', family: 'claude' },
    ]
    providers.push({
      id: 'anthropic',
      name: 'Anthropic',
      type: 'remote',
      endpoint: 'https://api.anthropic.com',
      status: 'online',
      models: anthropicModels,
    })
  }

  const allModels = providers.flatMap(p => p.models)

  logger.info({ providerCount: providers.length, modelCount: allModels.length }, 'LLM discovery complete')

  return NextResponse.json({ providers, models: allModels })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
