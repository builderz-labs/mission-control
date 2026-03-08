import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'

const GATEWAY_TIMEOUT = 5000

function getGatewayUrl(): string {
  return `http://${config.gatewayHost}:${config.gatewayPort}`
}

async function fetchGateway(path: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT)
  try {
    return await fetch(`${getGatewayUrl()}${path}`, {
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const action = request.nextUrl.searchParams.get('action') || 'list'

  if (action === 'list') {
    try {
      const res = await fetchGateway('/api/presence')
      if (!res.ok) {
        logger.warn({ status: res.status }, 'Gateway presence endpoint returned non-OK')
        return NextResponse.json({ nodes: [], connected: false })
      }
      const data = await res.json()
      return NextResponse.json(data)
    } catch (err) {
      logger.warn({ err }, 'Gateway unreachable for presence listing')
      return NextResponse.json({ nodes: [], connected: false })
    }
  }

  if (action === 'devices') {
    try {
      const res = await fetchGateway('/api/devices')
      if (!res.ok) {
        logger.warn({ status: res.status }, 'Gateway devices endpoint returned non-OK')
        return NextResponse.json({ devices: [] })
      }
      const data = await res.json()
      return NextResponse.json(data)
    } catch (err) {
      logger.warn({ err }, 'Gateway unreachable for device listing')
      return NextResponse.json({ devices: [] })
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
