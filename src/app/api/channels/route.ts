import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'

const gatewayInternalUrl = `http://${config.gatewayHost}:${config.gatewayPort}`

/**
 * GET /api/channels - Fetch channel status from the gateway
 * Supports ?action=probe&channel=<name> to probe a specific channel
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  // Probe a specific channel
  if (action === 'probe') {
    const channel = searchParams.get('channel')
    if (!channel) {
      return NextResponse.json({ error: 'channel parameter required' }, { status: 400 })
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      const res = await fetch(`${gatewayInternalUrl}/api/channels/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      const data = await res.json()
      return NextResponse.json(data)
    } catch (err) {
      logger.warn({ err, channel }, 'Channel probe failed')
      return NextResponse.json(
        { ok: false, error: 'Gateway unreachable' },
        { status: 502 },
      )
    }
  }

  // Default: fetch all channel statuses
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(`${gatewayInternalUrl}/api/channels/status`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const data = await res.json()
    return NextResponse.json(data)
  } catch (err) {
    logger.warn({ err }, 'Gateway unreachable for channel status')
    return NextResponse.json({ channels: [], connected: false })
  }
}
