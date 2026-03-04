import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { deliverWebhookPublic } from '@/lib/webhooks'
import { logger } from '@/lib/logger'

/**
 * POST /api/webhooks/retry - Manually retry a failed delivery
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { delivery_id } = await request.json()

    if (!delivery_id) {
      return NextResponse.json({ error: 'delivery_id is required' }, { status: 400 })
    }

    const delivery = db.prepare(`
      SELECT wd.*, w.id as w_id, w.name as w_name, w.url as w_url, w.secret as w_secret,
             w.events as w_events, w.enabled as w_enabled, w.workspace_id as w_workspace_id
      FROM webhook_deliveries wd
      JOIN webhooks w ON w.id = wd.webhook_id AND w.workspace_id = wd.workspace_id
      WHERE wd.id = ? AND wd.workspace_id = ?
    `).get(delivery_id, workspaceId) as any

    if (!delivery) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }

    const webhook = {
      id: delivery.w_id,
      name: delivery.w_name,
      url: delivery.w_url,
      secret: delivery.w_secret,
      events: delivery.w_events,
      enabled: delivery.w_enabled,
      workspace_id: delivery.w_workspace_id,
    }

    // Parse the original payload
    let parsedPayload: Record<string, any>
    try {
      const parsed = JSON.parse(delivery.payload)
      parsedPayload = parsed.data ?? parsed
    } catch {
      parsedPayload = {}
    }

    const result = await deliverWebhookPublic(webhook, delivery.event_type, parsedPayload, {
      attempt: (delivery.attempt ?? 0) + 1,
      parentDeliveryId: delivery.id,
      allowRetry: false, // Manual retries don't auto-schedule further retries
    })

    return NextResponse.json(result)
  } catch (error) {
    logger.error({ err: error }, 'POST /api/webhooks/retry error')
    return NextResponse.json({ error: 'Failed to retry delivery' }, { status: 500 })
  }
}
