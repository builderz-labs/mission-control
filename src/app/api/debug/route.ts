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
    })
    return res
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') || 'status'

  try {
    switch (action) {
      case 'status': {
        try {
          const res = await gatewayFetch('/api/status')
          const data = await res.json()
          return NextResponse.json(data)
        } catch (err) {
          logger.warn({ err }, 'debug: gateway unreachable for status')
          return NextResponse.json({ gatewayReachable: false })
        }
      }

      case 'health': {
        try {
          const res = await gatewayFetch('/api/health')
          const data = await res.json()
          return NextResponse.json(data)
        } catch (err) {
          logger.warn({ err }, 'debug: gateway unreachable for health')
          return NextResponse.json({ healthy: false, error: 'Gateway unreachable' })
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
        try {
          const res = await gatewayFetch('/api/heartbeat', { timeoutMs: 3000 })
          const latencyMs = Math.round(performance.now() - start)
          const ok = res.ok
          return NextResponse.json({ ok, latencyMs, timestamp: Date.now() })
        } catch {
          const latencyMs = Math.round(performance.now() - start)
          return NextResponse.json({ ok: false, latencyMs, timestamp: Date.now() })
        }
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    logger.error({ err }, 'debug: unexpected error')
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

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

  if (!path || typeof path !== 'string' || !path.startsWith('/api/')) {
    return NextResponse.json({ error: 'path must start with /api/' }, { status: 400 })
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
