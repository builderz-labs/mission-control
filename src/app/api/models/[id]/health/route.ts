import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'

interface ModelConfigRow {
  id: number
  workspace_id: number
  alias: string
  name: string
  provider: string
  api_key_encrypted: string | null
  base_url: string | null
  enabled: number
}

interface HealthRow {
  id: number
  model_id: number
  status: string
  latency: number | null
  error: string | null
  checked_at: number
}

const PROVIDER_HEALTH_ENDPOINTS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/models',
  groq: 'https://api.groq.com/openai/v1/models',
}

/**
 * GET /api/models/[id]/health - Get health check history for a model
 * Query params: limit (default 20)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id: idStr } = await params
  const id = parseInt(idStr)
  if (!id) return NextResponse.json({ error: 'Invalid model id' }, { status: 400 })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)

    const model = db.prepare('SELECT * FROM model_configs WHERE id = ? AND workspace_id = ?').get(id, workspaceId) as ModelConfigRow | undefined
    if (!model) return NextResponse.json({ error: 'Model not found' }, { status: 404 })

    const checks = db.prepare(
      'SELECT * FROM model_health_checks WHERE model_id = ? ORDER BY checked_at DESC LIMIT ?'
    ).all(id, limit) as HealthRow[]

    return NextResponse.json({ checks })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch health checks' }, { status: 500 })
  }
}

/**
 * POST /api/models/[id]/health - Run a health check against a model endpoint
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  const { id: idStr } = await params
  const id = parseInt(idStr)
  if (!id) return NextResponse.json({ error: 'Invalid model id' }, { status: 400 })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const model = db.prepare('SELECT * FROM model_configs WHERE id = ? AND workspace_id = ?').get(id, workspaceId) as ModelConfigRow | undefined
    if (!model) return NextResponse.json({ error: 'Model not found' }, { status: 404 })

    let status: 'healthy' | 'degraded' | 'down' = 'down'
    let latency: number | null = null
    let error: string | null = null

    const baseUrl = model.base_url || PROVIDER_HEALTH_ENDPOINTS[model.provider]
    if (!baseUrl) {
      // No endpoint to check — record as unknown
      status = 'healthy'
      db.prepare(
        'INSERT INTO model_health_checks (model_id, status, latency, error) VALUES (?, ?, ?, ?)'
      ).run(id, status, null, 'No health endpoint configured — assumed healthy')

      return NextResponse.json({ status, latency: null, error: null })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    try {
      const start = Date.now()
      const headers: Record<string, string> = {}

      if (model.api_key_encrypted) {
        if (model.provider === 'anthropic') {
          headers['x-api-key'] = model.api_key_encrypted
          headers['anthropic-version'] = '2023-06-01'
        } else {
          headers['Authorization'] = `Bearer ${model.api_key_encrypted}`
        }
      }

      // Use HEAD for OpenAI-compatible /models endpoints, GET otherwise
      const method = baseUrl.endsWith('/models') ? 'GET' : 'POST'
      const fetchOpts: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      }

      // For POST endpoints (like Anthropic), send minimal body
      if (method === 'POST') {
        headers['Content-Type'] = 'application/json'
        fetchOpts.body = JSON.stringify({
          model: model.name.split('/').pop(),
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        })
      }

      const res = await fetch(baseUrl, fetchOpts)
      latency = Date.now() - start

      if (res.ok || res.status === 401 || res.status === 403) {
        // 401/403 means the endpoint is up but key may be wrong — still reachable
        status = res.ok ? 'healthy' : 'degraded'
        if (!res.ok) {
          error = `Endpoint reachable but returned ${res.status} — check API key`
        }
      } else if (res.status === 429) {
        status = 'degraded'
        error = 'Rate limited'
      } else {
        status = 'down'
        error = `HTTP ${res.status}`
      }
    } catch (fetchErr: any) {
      status = 'down'
      error = fetchErr?.name === 'AbortError' ? 'Health check timed out (10s)' : (fetchErr?.message || 'Connection failed')
    } finally {
      clearTimeout(timeout)
    }

    db.prepare(
      'INSERT INTO model_health_checks (model_id, status, latency, error) VALUES (?, ?, ?, ?)'
    ).run(id, status, latency, error)

    return NextResponse.json({ status, latency, error })
  } catch {
    return NextResponse.json({ error: 'Health check failed' }, { status: 500 })
  }
}
