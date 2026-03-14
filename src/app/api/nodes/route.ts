import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'

const GATEWAY_TIMEOUT = 5000

/** Probe the gateway HTTP /health endpoint to check reachability. */
async function isGatewayReachable(): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT)
  try {
    const res = await fetch(
      `http://${config.gatewayHost}:${config.gatewayPort}/health`,
      { signal: controller.signal },
    )
    return res.ok
  } catch {
    return false
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
      const connected = await isGatewayReachable()
      if (!connected) {
        return NextResponse.json({ nodes: [], connected: false })
      }

      try {
        const data = await callOpenClawGateway<{ nodes?: unknown[] }>('node.list', {}, GATEWAY_TIMEOUT)
        return NextResponse.json({ nodes: data?.nodes ?? [], connected: true })
      } catch (rpcErr) {
        // Gateway is reachable but openclaw CLI unavailable (e.g. Docker) or
        // node.list not supported — return connected=true with empty node list
        logger.warn({ err: rpcErr }, 'node.list RPC failed, returning empty node list')
        return NextResponse.json({ nodes: [], connected: true })
      }
    } catch (err) {
      logger.warn({ err }, 'Gateway unreachable for node listing')
      return NextResponse.json({ nodes: [], connected: false })
    }
  }

  if (action === 'devices') {
    try {
      const connected = await isGatewayReachable()
      if (!connected) {
        return NextResponse.json({ devices: [] })
      }

      try {
        const data = await callOpenClawGateway<{ devices?: unknown[] }>(
          'device.pair.list',
          {},
          GATEWAY_TIMEOUT,
        )
        return NextResponse.json({ devices: data?.devices ?? [] })
      } catch (rpcErr) {
        logger.warn({ err: rpcErr }, 'device.pair.list RPC failed, returning empty device list')
        return NextResponse.json({ devices: [] })
      }
    } catch (err) {
      logger.warn({ err }, 'Gateway unreachable for device listing')
      return NextResponse.json({ devices: [] })
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}

const VALID_DEVICE_ACTIONS = ['approve', 'reject', 'rotate-token', 'revoke-token'] as const
type DeviceAction = (typeof VALID_DEVICE_ACTIONS)[number]

/** Map UI action names to gateway RPC method names and their required param keys. */
const ACTION_RPC_MAP: Record<DeviceAction, { method: string; paramKey: 'requestId' | 'deviceId' }> = {
  'approve':      { method: 'device.pair.approve', paramKey: 'requestId' },
  'reject':       { method: 'device.pair.reject',  paramKey: 'requestId' },
  'rotate-token': { method: 'device.token.rotate',  paramKey: 'deviceId' },
  'revoke-token': { method: 'device.token.revoke',  paramKey: 'deviceId' },
}

/**
 * POST /api/nodes - Device management actions
 * Body: { action: DeviceAction, requestId?: string, deviceId?: string, role?: string, scopes?: string[] }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const action = body.action as string
  if (!action || !VALID_DEVICE_ACTIONS.includes(action as DeviceAction)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${VALID_DEVICE_ACTIONS.join(', ')}` },
      { status: 400 },
    )
  }

  const spec = ACTION_RPC_MAP[action as DeviceAction]

  // Validate required param
  const id = body[spec.paramKey] as string | undefined
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: `Missing required field: ${spec.paramKey}` }, { status: 400 })
  }

  // Build RPC params
  const params: Record<string, unknown> = { [spec.paramKey]: id }
  if ((action === 'rotate-token' || action === 'revoke-token') && body.role) {
    params.role = body.role
  }
  if (action === 'rotate-token' && Array.isArray(body.scopes)) {
    params.scopes = body.scopes
  }

  try {
    const result = await callOpenClawGateway(spec.method, params, GATEWAY_TIMEOUT)
    return NextResponse.json(result)
  } catch (err: unknown) {
    logger.error({ err }, 'Gateway device action failed')
    return NextResponse.json({ error: 'Gateway device action failed' }, { status: 502 })
  }
}
