import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { getDatabase } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'

interface InboundWebhook {
  id: number
  name: string
  slug: string
  secret: string
  enabled: number
  allowed_events: string
  source_ip_allowlist: string | null
  created_at: number
  updated_at: number
}

/**
 * POST /api/webhooks/inbound?slug=<slug> - Receive an inbound webhook
 *
 * Expected payload:
 *   { "event": "some.event.type", "data": { ... } }
 *
 * Signature header (required):
 *   X-Webhook-Signature: sha256=<hex-hmac>
 *
 * The HMAC is computed over the raw request body using the inbound webhook's secret.
 */
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const slug = searchParams.get('slug')

  if (!slug) {
    return NextResponse.json({ error: 'Missing slug parameter' }, { status: 400 })
  }

  let db: ReturnType<typeof getDatabase>
  try {
    db = getDatabase()
  } catch {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }

  // Look up the inbound webhook by slug
  const webhook = db.prepare(
    'SELECT * FROM inbound_webhooks WHERE slug = ? AND enabled = 1'
  ).get(slug) as InboundWebhook | undefined

  if (!webhook) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  }

  // Optional IP allowlist check
  if (webhook.source_ip_allowlist) {
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'

    try {
      const allowed: string[] = JSON.parse(webhook.source_ip_allowlist)
      if (allowed.length > 0 && !allowed.includes(clientIp)) {
        logger.warn({ slug, clientIp }, 'Inbound webhook: IP not in allowlist')
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } catch { /* invalid allowlist JSON — skip check */ }
  }

  // Read raw body for signature verification
  const rawBody = await request.text()

  // Verify HMAC signature
  const signatureHeader = request.headers.get('x-webhook-signature')
    || request.headers.get('x-hub-signature-256')  // GitHub-style
    || request.headers.get('x-mc-signature')       // MC-style

  if (!signatureHeader) {
    logInboundDelivery(db, webhook.id, 'missing_signature', null, rawBody, 'No signature header provided')
    return NextResponse.json({ error: 'Missing signature header' }, { status: 401 })
  }

  const expectedSig = createHmac('sha256', webhook.secret).update(rawBody).digest('hex')
  const expectedFull = `sha256=${expectedSig}`

  // Use timing-safe comparison to prevent timing attacks
  const sigToCompare = signatureHeader.startsWith('sha256=') ? signatureHeader : `sha256=${signatureHeader}`
  const isValid = sigToCompare.length === expectedFull.length
    && timingSafeEqual(Buffer.from(sigToCompare), Buffer.from(expectedFull))

  if (!isValid) {
    logInboundDelivery(db, webhook.id, 'invalid_signature', null, rawBody, 'Signature mismatch')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Parse the payload
  let payload: { event?: string; data?: any }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    logInboundDelivery(db, webhook.id, 'invalid_json', null, rawBody, 'Invalid JSON body')
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const eventType = payload.event || 'unknown'

  // Check if event type is allowed
  if (webhook.allowed_events && webhook.allowed_events !== '["*"]') {
    try {
      const allowed: string[] = JSON.parse(webhook.allowed_events)
      if (!allowed.includes('*') && !allowed.includes(eventType)) {
        logInboundDelivery(db, webhook.id, 'rejected_event', eventType, rawBody, `Event type "${eventType}" not allowed`)
        return NextResponse.json({ error: `Event type "${eventType}" not allowed` }, { status: 422 })
      }
    } catch { /* invalid JSON — allow all */ }
  }

  // Broadcast to internal event bus
  eventBus.broadcast(`inbound.${eventType}` as any, {
    source: webhook.name,
    slug: webhook.slug,
    event: eventType,
    data: payload.data || payload,
    received_at: Math.floor(Date.now() / 1000),
  })

  // Log successful delivery
  logInboundDelivery(db, webhook.id, 'success', eventType, rawBody, null)

  // Update last_received_at
  db.prepare('UPDATE inbound_webhooks SET last_received_at = unixepoch(), updated_at = unixepoch() WHERE id = ?')
    .run(webhook.id)

  return NextResponse.json({ received: true, event: eventType })
}

function logInboundDelivery(
  db: ReturnType<typeof getDatabase>,
  webhookId: number,
  status: string,
  eventType: string | null,
  payload: string,
  error: string | null,
) {
  try {
    db.prepare(`
      INSERT INTO inbound_webhook_deliveries (webhook_id, event_type, payload, status, error)
      VALUES (?, ?, ?, ?, ?)
    `).run(webhookId, eventType, payload.slice(0, 5000), status, error)

    // Prune old deliveries (keep last 500 per webhook)
    db.prepare(`
      DELETE FROM inbound_webhook_deliveries
      WHERE webhook_id = ? AND id NOT IN (
        SELECT id FROM inbound_webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 500
      )
    `).run(webhookId, webhookId)
  } catch (err) {
    logger.error({ err }, 'Failed to log inbound webhook delivery')
  }
}
