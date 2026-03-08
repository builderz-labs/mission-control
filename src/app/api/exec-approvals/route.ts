import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'

function gatewayUrl(path: string): string {
  return `http://${config.gatewayHost}:${config.gatewayPort}${path}`
}

/**
 * GET /api/exec-approvals - Fetch pending execution approval requests
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(gatewayUrl('/api/exec-approvals'), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    })
    clearTimeout(timeout)

    if (!res.ok) {
      logger.warn({ status: res.status }, 'Gateway exec-approvals endpoint returned error')
      return NextResponse.json({ approvals: [] })
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') {
      logger.warn('Gateway exec-approvals request timed out')
    } else {
      logger.warn({ err }, 'Gateway exec-approvals unreachable')
    }
    return NextResponse.json({ approvals: [] })
  }
}

/**
 * POST /api/exec-approvals - Respond to an execution approval request
 * Body: { id: string, action: 'approve' | 'deny' | 'always_allow', reason?: string }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { id: string; action: string; reason?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.id || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'Missing required field: id' }, { status: 400 })
  }

  const validActions = ['approve', 'deny', 'always_allow']
  if (!validActions.includes(body.action)) {
    return NextResponse.json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` }, { status: 400 })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(gatewayUrl('/api/exec-approvals/respond'), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: body.id,
        action: body.action,
        reason: body.reason,
      }),
    })
    clearTimeout(timeout)

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') {
      logger.error('Gateway exec-approvals respond request timed out')
      return NextResponse.json({ error: 'Gateway request timed out' }, { status: 504 })
    }
    logger.error({ err }, 'Gateway exec-approvals respond failed')
    return NextResponse.json({ error: 'Gateway unreachable' }, { status: 502 })
  }
}
