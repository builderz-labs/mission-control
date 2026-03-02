import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { deliverWebhookPublic } from '@/lib/webhooks'
import { logger } from '@/lib/logger'

/**
 * POST /api/webhooks/test - Send a test event to a webhook
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { id } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 })
    }

    const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as any
    if (!webhook) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    const payload = {
      message: 'This is a test webhook from Mission Control',
      webhook_id: webhook.id,
      webhook_name: webhook.name,
      triggered_by: auth.user.username,
    }

    const result = await deliverWebhookPublic(webhook, 'test.ping', payload, { allowRetry: false })

    return NextResponse.json(result)
  } catch (error) {
    logger.error({ err: error }, 'POST /api/webhooks/test error')
    return NextResponse.json({ error: 'Failed to test webhook' }, { status: 500 })
  }
}
