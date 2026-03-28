import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { config } from '@/lib/config'
import { mutationLimiter, readLimiter } from '@/lib/rate-limit'

function getConfigPath(): string | null {
  return config.openclawConfigPath || null
}

function computeHash(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/** Mask an API key for display: show first 4 and last 4 chars */
function maskKey(key: string): string {
  if (!key || key.length < 10) return key ? '********' : ''
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

interface ProviderConfig {
  id: string
  name: string
  baseUrl?: string
  apiKey?: string
  models?: string[]
  enabled?: boolean
}

/**
 * GET /api/models - Read models.providers + agents.defaults.model from openclaw.json
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  const configPath = getConfigPath()
  if (!configPath) {
    return NextResponse.json({ error: 'OPENCLAW_CONFIG_PATH not configured' }, { status: 404 })
  }

  try {
    const { readFile } = require('fs/promises')
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw)
    const hash = computeHash(raw)

    const modelsSection = parsed.models || {}
    const providers: ProviderConfig[] = Array.isArray(modelsSection.providers) ? modelsSection.providers : []
    const fallback: string[] = Array.isArray(modelsSection.fallback) ? modelsSection.fallback : []
    const defaultModel: string = parsed.agents?.defaults?.model || ''

    // Mask API keys for display
    const redactedProviders = providers.map(p => ({
      ...p,
      apiKey: p.apiKey ? maskKey(p.apiKey) : '',
      hasApiKey: !!p.apiKey,
    }))

    return NextResponse.json({
      providers: redactedProviders,
      fallback,
      defaultModel,
      hash,
      path: configPath,
    })
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return NextResponse.json({ error: 'Config file not found', path: configPath }, { status: 404 })
    }
    return NextResponse.json({ error: `Failed to read config: ${err.message}` }, { status: 500 })
  }
}

/**
 * PUT /api/models - Update provider configs and/or fallback chain
 * Body: { providers?: ProviderConfig[], fallback?: string[], defaultModel?: string, hash?: string }
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const configPath = getConfigPath()
  if (!configPath) {
    return NextResponse.json({ error: 'OPENCLAW_CONFIG_PATH not configured' }, { status: 404 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const { readFile, writeFile } = require('fs/promises')
    const raw = await readFile(configPath, 'utf-8')

    // Hash-based concurrency check
    if (body.hash) {
      const serverHash = computeHash(raw)
      if (body.hash !== serverHash) {
        return NextResponse.json(
          { error: 'Config has been modified by another user. Please reload and try again.', code: 'CONFLICT' },
          { status: 409 },
        )
      }
    }

    const parsed = JSON.parse(raw)
    const updatedKeys: string[] = []

    // Update providers
    if (body.providers !== undefined) {
      if (!Array.isArray(body.providers)) {
        return NextResponse.json({ error: 'providers must be an array' }, { status: 400 })
      }
      // Validate each provider
      for (const p of body.providers) {
        if (!p.id || typeof p.id !== 'string') {
          return NextResponse.json({ error: 'Each provider must have an id' }, { status: 400 })
        }
      }

      // Merge API keys: if a provider has no apiKey in the update, preserve existing
      if (!parsed.models) parsed.models = {}
      const existingProviders: ProviderConfig[] = Array.isArray(parsed.models.providers) ? parsed.models.providers : []
      const existingMap = new Map(existingProviders.map(p => [p.id, p]))

      parsed.models.providers = body.providers.map((p: any) => {
        const existing = existingMap.get(p.id)
        const result: any = { ...p }
        // If apiKey not provided or empty, preserve existing key
        if (!result.apiKey && existing?.apiKey) {
          result.apiKey = existing.apiKey
        }
        return result
      })
      updatedKeys.push('models.providers')
    }

    // Update fallback chain
    if (body.fallback !== undefined) {
      if (!Array.isArray(body.fallback)) {
        return NextResponse.json({ error: 'fallback must be an array of model aliases' }, { status: 400 })
      }
      if (!parsed.models) parsed.models = {}
      parsed.models.fallback = body.fallback
      updatedKeys.push('models.fallback')
    }

    // Update default model
    if (body.defaultModel !== undefined) {
      if (typeof body.defaultModel !== 'string') {
        return NextResponse.json({ error: 'defaultModel must be a string' }, { status: 400 })
      }
      if (!parsed.agents) parsed.agents = {}
      if (!parsed.agents.defaults) parsed.agents.defaults = {}
      parsed.agents.defaults.model = body.defaultModel
      updatedKeys.push('agents.defaults.model')
    }

    if (updatedKeys.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const newRaw = JSON.stringify(parsed, null, 2) + '\n'
    await writeFile(configPath, newRaw)

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'model_config_update',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { updated_keys: updatedKeys },
      ip_address: ipAddress,
    })

    return NextResponse.json({
      updated: updatedKeys,
      hash: computeHash(newRaw),
    })
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to update config: ${err.message}` }, { status: 500 })
  }
}

const PROVIDER_ENDPOINTS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/models',
  groq: 'https://api.groq.com/openai/v1/models',
  ollama: 'http://localhost:11434/api/tags',
  moonshot: 'https://api.moonshot.cn/v1/models',
  venice: 'https://api.venice.ai/api/v1/models',
  minimax: 'https://api.minimax.chat/v1/models',
}

/** Resolve API key from config if not provided */
async function resolveApiKey(providerId: string, explicitKey?: string): Promise<string | undefined> {
  if (explicitKey) return explicitKey
  const configPath = getConfigPath()
  if (!configPath) return undefined
  try {
    const { readFile } = require('fs/promises')
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw)
    const providers: ProviderConfig[] = Array.isArray(parsed.models?.providers) ? parsed.models.providers : []
    const match = providers.find(p => p.id === providerId)
    return match?.apiKey || undefined
  } catch { return undefined }
}

/** Ping a single provider endpoint and return health result */
async function pingProvider(opts: {
  provider: string
  baseUrl?: string
  apiKey?: string
  model?: string
}): Promise<{ provider: string; model?: string; status: string; latency: number; error?: string }> {
  const resolvedKey = await resolveApiKey(opts.provider, opts.apiKey)
  const url = opts.baseUrl || PROVIDER_ENDPOINTS[opts.provider]

  if (!url) {
    return { provider: opts.provider, model: opts.model, status: 'unknown', latency: 0, error: `Unknown provider "${opts.provider}" — provide a baseUrl` }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  const start = Date.now()

  try {
    const headers: Record<string, string> = {}
    if (resolvedKey) {
      if (opts.provider === 'anthropic') {
        headers['x-api-key'] = resolvedKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        headers['Authorization'] = `Bearer ${resolvedKey}`
      }
    }

    let res: Response
    if (opts.provider === 'anthropic') {
      headers['Content-Type'] = 'application/json'
      res = await fetch(url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: opts.model || 'claude-3-5-haiku-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      })
    } else if (opts.provider === 'ollama') {
      res = await fetch(url, { signal: controller.signal })
    } else {
      res = await fetch(url, { headers, signal: controller.signal })
    }

    const latency = Date.now() - start
    if (res.ok) {
      return { provider: opts.provider, model: opts.model, status: 'healthy', latency }
    } else if (res.status === 401 || res.status === 403) {
      return { provider: opts.provider, model: opts.model, status: 'degraded', latency, error: 'Authentication failed — check API key' }
    } else if (res.status === 429) {
      return { provider: opts.provider, model: opts.model, status: 'degraded', latency, error: 'Rate limited' }
    } else {
      return { provider: opts.provider, model: opts.model, status: 'down', latency, error: `HTTP ${res.status}` }
    }
  } catch (err: any) {
    const latency = Date.now() - start
    return {
      provider: opts.provider,
      model: opts.model,
      status: 'down',
      latency,
      error: err?.name === 'AbortError' ? 'Timed out (10s)' : (err?.message || 'Connection failed'),
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * POST /api/models?action=ping - Test a single model endpoint
 * POST /api/models?action=ping-all - Test every model in the fallback chain
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const action = request.nextUrl.searchParams.get('action')

  if (action === 'ping-all') {
    const configPath = getConfigPath()
    if (!configPath) {
      return NextResponse.json({ error: 'OPENCLAW_CONFIG_PATH not configured' }, { status: 404 })
    }
    try {
      const { readFile } = require('fs/promises')
      const raw = await readFile(configPath, 'utf-8')
      const parsed = JSON.parse(raw)
      const providers: ProviderConfig[] = Array.isArray(parsed.models?.providers) ? parsed.models.providers : []
      const fallback: string[] = Array.isArray(parsed.models?.fallback) ? parsed.models.fallback : []

      // Build provider lookup
      const providerMap = new Map(providers.map(p => [p.id, p]))

      // Ping every model in the fallback chain (or all providers if no chain)
      const targets = fallback.length > 0
        ? fallback.map(modelAlias => {
            // Find which provider owns this model alias
            const provider = providers.find(p => p.models?.includes(modelAlias))
            return { provider: provider?.id || modelAlias, model: modelAlias, baseUrl: provider?.baseUrl }
          })
        : providers.map(p => ({ provider: p.id, model: p.models?.[0], baseUrl: p.baseUrl }))

      const results = await Promise.all(
        targets.map(t => pingProvider({ provider: t.provider, model: t.model, baseUrl: t.baseUrl }))
      )

      return NextResponse.json({ results, checkedAt: Date.now() })
    } catch (err: any) {
      return NextResponse.json({ error: `Failed to ping models: ${err.message}` }, { status: 500 })
    }
  }

  if (action === 'ping') {
    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { provider, baseUrl, apiKey, model } = body as {
      provider?: string
      baseUrl?: string
      apiKey?: string
      model?: string
    }

    if (!provider) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 })
    }

    const result = await pingProvider({ provider, baseUrl, apiKey, model })
    return NextResponse.json(result)
  }

  return NextResponse.json({ error: 'Unknown action. Use ?action=ping or ?action=ping-all' }, { status: 400 })
}
