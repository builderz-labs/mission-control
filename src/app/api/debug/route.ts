import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'

const GATEWAY_BASE = `http://${config.gatewayHost}:${config.gatewayPort}`

async function gatewayFetch(
  path: string,
  options: { method?: string; body?: string; timeoutMs?: number } = {}
): Promise<Response> {
  const { method = 'GET', body, timeoutMs = 5000 } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${GATEWAY_BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body,
      cache: 'no-store',
    })
    return res
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Try multiple candidate paths in order, return the first successful response.
 * Supports both legacy (/api/*) and current (/healthz, /health, /ready) gateway routes.
 */
async function gatewayProbe(
  candidates: string[],
  options?: { timeoutMs?: number }
): Promise<{ res: Response; path: string } | null> {
  for (const path of candidates) {
    try {
      const res = await gatewayFetch(path, { timeoutMs: options?.timeoutMs ?? 3000 })
      if (res.ok) return { res, path }
    } catch {
      // try next candidate
    }
  }
  return null
}

export async function GET(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') || 'status'

  try {
    switch (action) {
      case 'status': {
        const probe = await gatewayProbe(['/api/status', '/healthz', '/health'])
        if (!probe) {
          return NextResponse.json({ gatewayReachable: false })
        }
        try {
          const data = await probe.res.json()
          return NextResponse.json({ ...data, gatewayReachable: true, probedPath: probe.path })
        } catch {
          return NextResponse.json({ gatewayReachable: true, probedPath: probe.path })
        }
      }

      case 'health': {
        const probe = await gatewayProbe(['/api/health', '/health', '/healthz', '/ready'])
        if (!probe) {
          return NextResponse.json({ healthy: false, error: 'Gateway unreachable' })
        }
        try {
          const data = await probe.res.json()
          return NextResponse.json({ ...data, healthy: true, probedPath: probe.path })
        } catch {
          return NextResponse.json({ healthy: true, probedPath: probe.path })
        }
      }

      case 'models': {
        try {
          const res = await gatewayFetch('/api/models')
          const data = await res.json()
          return NextResponse.json(data)
        } catch (err) {
          logger.warn({ err }, 'debug: gateway unreachable for models')
          return NextResponse.json({ models: [] })
        }
      }

      case 'heartbeat': {
        const start = performance.now()
        const probe = await gatewayProbe(['/api/heartbeat', '/healthz', '/ready'], { timeoutMs: 3000 })
        const latencyMs = Math.round(performance.now() - start)
        if (probe) {
          return NextResponse.json({ ok: true, latencyMs, timestamp: Date.now(), probedPath: probe.path })
        }
        return NextResponse.json({ ok: false, latencyMs, timestamp: Date.now() })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    logger.error({ err }, 'debug: unexpected error')
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// Restrict proxy calls to known safe gateway paths to prevent SSRF
const ALLOWED_GATEWAY_PATHS = [
  // Legacy gateway routes
  '/api/status', '/api/health', '/api/models', '/api/heartbeat', '/api/agents', '/api/config',
  // Current OpenClaw gateway routes
  '/healthz', '/health', '/ready',
]

export async function POST(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  if (action !== 'call') {
    return NextResponse.json({ error: 'POST only supports action=call' }, { status: 400 })
  }

  let body: { method?: string; path?: string; body?: any }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { method, path, body: callBody } = body

  if (!method || !['GET', 'POST'].includes(method)) {
    return NextResponse.json({ error: 'method must be GET or POST' }, { status: 400 })
  }

  if (!path || typeof path !== 'string' || !path.startsWith('/')) {
    return NextResponse.json({ error: 'path must start with /' }, { status: 400 })
  }

  const normalizedPath = path.split('?')[0]
  if (!ALLOWED_GATEWAY_PATHS.some(allowed => normalizedPath === allowed || normalizedPath.startsWith(allowed + '/'))) {
    return NextResponse.json({ error: 'Path not in allowed gateway paths' }, { status: 403 })
  }

  try {
    const res = await gatewayFetch(path, {
      method,
      body: callBody ? JSON.stringify(callBody) : undefined,
      timeoutMs: 5000,
    })

    let responseBody: any
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      responseBody = await res.json()
    } else {
      responseBody = await res.text()
    }

    return NextResponse.json({
      status: res.status,
      statusText: res.statusText,
      contentType,
      body: responseBody,
    })
  } catch (err) {
    logger.warn({ err, path }, 'debug: gateway call failed')
    return NextResponse.json({ error: 'Gateway unreachable', path }, { status: 502 })
  }
}
