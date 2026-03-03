import { createHmac } from 'crypto'
import { eventBus, type ServerEvent } from './event-bus'
import { logger } from './logger'

// Retry configuration
const MAX_RETRIES = 5
const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000, 16000] // Exponential: 1s, 2s, 4s, 8s, 16s

interface Webhook {
  id: number
  name: string
  url: string
  secret: string | null
  events: string // JSON array
  enabled: number
}

// Map event bus events to webhook event types
const EVENT_MAP: Record<string, string> = {
  'activity.created': 'activity',         // Dynamically becomes activity.<type>
  'notification.created': 'notification',  // Dynamically becomes notification.<type>
  'agent.status_changed': 'agent.status_change',
  'audit.security': 'security',           // Dynamically becomes security.<action>
  'task.created': 'activity.task_created',
  'task.updated': 'activity.task_updated',
  'task.deleted': 'activity.task_deleted',
}

/**
 * Subscribe to the event bus and fire webhooks for matching events.
 * Called once during server initialization.
 */
export function initWebhookListener() {
  eventBus.on('server-event', (event: ServerEvent) => {
    const mapping = EVENT_MAP[event.type]
    if (!mapping) return

    // Build the specific webhook event type
    let webhookEventType: string
    if (mapping === 'activity' && event.data?.type) {
      webhookEventType = `activity.${event.data.type}`
    } else if (mapping === 'notification' && event.data?.type) {
      webhookEventType = `notification.${event.data.type}`
    } else if (mapping === 'security' && event.data?.action) {
      webhookEventType = `security.${event.data.action}`
    } else {
      webhookEventType = mapping
    }

    // Also fire agent.error for error status specifically
    const isAgentError = event.type === 'agent.status_changed' && event.data?.status === 'error'

    fireWebhooksAsync(webhookEventType, event.data).catch((err) => {
      logger.error({ err }, 'Webhook dispatch error')
    })

    if (isAgentError) {
      fireWebhooksAsync('agent.error', event.data).catch((err) => {
        logger.error({ err }, 'Webhook dispatch error')
      })
    }
  })
}

/**
 * Fire all matching webhooks for an event type (public for test endpoint).
 */
export function fireWebhooks(eventType: string, payload: Record<string, any>) {
  fireWebhooksAsync(eventType, payload).catch((err) => {
    logger.error({ err }, 'Webhook dispatch error')
  })
}

async function fireWebhooksAsync(eventType: string, payload: Record<string, any>) {
  let webhooks: Webhook[]
  try {
    // Lazy import to avoid circular dependency
    const { getDatabase } = await import('./db')
    const db = getDatabase()
    webhooks = db.prepare(
      'SELECT * FROM webhooks WHERE enabled = 1'
    ).all() as Webhook[]
  } catch {
    return // DB not ready or table doesn't exist yet
  }

  if (webhooks.length === 0) return

  const matchingWebhooks = webhooks.filter((wh) => {
    try {
      const events: string[] = JSON.parse(wh.events)
      return events.includes('*') || events.includes(eventType)
    } catch {
      return false
    }
  })

  await Promise.allSettled(
    matchingWebhooks.map((wh) => deliverWebhook(wh, eventType, payload))
  )
}

async function deliverWebhook(
  webhook: Webhook,
  eventType: string,
  payload: Record<string, any>
) {
  const body = JSON.stringify({
    event: eventType,
    timestamp: Math.floor(Date.now() / 1000),
    data: payload,
  })

  const { statusCode, responseBody, error, durationMs } = await attemptDelivery(webhook.url, webhook.secret, eventType, body)

  const isSuccess = statusCode !== null && statusCode >= 200 && statusCode < 300

  // Log delivery attempt
  try {
    const { getDatabase } = await import('./db')
    const db = getDatabase()

    // Determine retry scheduling
    let deliveryStatus: string
    let nextRetryAt: number | null = null

    if (isSuccess) {
      deliveryStatus = 'success'
    } else {
      // Schedule first retry
      const delayMs = BACKOFF_DELAYS_MS[0] || 1000
      nextRetryAt = Math.floor((Date.now() + delayMs) / 1000)
      deliveryStatus = 'pending_retry'
    }

    db.prepare(`
      INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status_code, response_body, error, duration_ms, retry_count, max_retries, next_retry_at, delivery_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      webhook.id,
      eventType,
      body,
      statusCode,
      responseBody,
      error,
      durationMs,
      MAX_RETRIES,
      nextRetryAt,
      deliveryStatus
    )

    // Update webhook last_fired
    db.prepare(`
      UPDATE webhooks SET last_fired_at = unixepoch(), last_status = ?, updated_at = unixepoch()
      WHERE id = ?
    `).run(statusCode ?? -1, webhook.id)

    // Prune old deliveries (keep last 200 per webhook)
    db.prepare(`
      DELETE FROM webhook_deliveries
      WHERE webhook_id = ? AND id NOT IN (
        SELECT id FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 200
      )
    `).run(webhook.id, webhook.id)
  } catch {
    // Silent - delivery logging is best-effort
  }
}

/**
 * Perform the actual HTTP delivery attempt.
 */
async function attemptDelivery(
  url: string,
  secret: string | null,
  eventType: string,
  body: string
): Promise<{ statusCode: number | null; responseBody: string | null; error: string | null; durationMs: number }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'MissionControl-Webhook/1.0',
    'X-MC-Event': eventType,
  }

  // HMAC signature if secret is configured
  if (secret) {
    const sig = createHmac('sha256', secret).update(body).digest('hex')
    headers['X-MC-Signature'] = `sha256=${sig}`
  }

  const start = Date.now()
  let statusCode: number | null = null
  let responseBody: string | null = null
  let error: string | null = null

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

    clearTimeout(timeout)
    statusCode = res.status
    responseBody = await res.text().catch(() => null)
    if (responseBody && responseBody.length > 1000) {
      responseBody = responseBody.slice(0, 1000) + '...'
    }
  } catch (err: any) {
    error = err.name === 'AbortError' ? 'Timeout (10s)' : err.message
  }

  return { statusCode, responseBody, error, durationMs: Date.now() - start }
}

/**
 * Process pending webhook retries. Called by the scheduler every minute.
 * Picks up deliveries with delivery_status='pending_retry' whose next_retry_at has passed.
 */
export async function processWebhookRetries(): Promise<{ ok: boolean; message: string }> {
  try {
    const { getDatabase } = await import('./db')
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)

    // Get deliveries due for retry (limit batch to 20 to avoid overload)
    const pending = db.prepare(`
      SELECT wd.*, w.url, w.secret, w.enabled
      FROM webhook_deliveries wd
      JOIN webhooks w ON wd.webhook_id = w.id
      WHERE wd.delivery_status = 'pending_retry'
        AND wd.next_retry_at <= ?
        AND w.enabled = 1
      ORDER BY wd.next_retry_at ASC
      LIMIT 20
    `).all(now) as Array<any>

    if (pending.length === 0) {
      return { ok: true, message: 'No pending retries' }
    }

    let succeeded = 0
    let retried = 0
    let exhausted = 0

    for (const delivery of pending) {
      const nextAttempt = delivery.retry_count + 1
      const { statusCode, responseBody, error, durationMs } = await attemptDelivery(
        delivery.url,
        delivery.secret,
        delivery.event_type,
        delivery.payload
      )

      const isSuccess = statusCode !== null && statusCode >= 200 && statusCode < 300

      if (isSuccess) {
        // Retry succeeded
        db.prepare(`
          UPDATE webhook_deliveries
          SET delivery_status = 'success', retry_count = ?, status_code = ?, response_body = ?, error = NULL, duration_ms = ?, next_retry_at = NULL
          WHERE id = ?
        `).run(nextAttempt, statusCode, responseBody, durationMs, delivery.id)

        db.prepare(`
          UPDATE webhooks SET last_status = ?, updated_at = unixepoch() WHERE id = ?
        `).run(statusCode, delivery.webhook_id)

        succeeded++
      } else if (nextAttempt >= delivery.max_retries) {
        // Max retries exhausted
        db.prepare(`
          UPDATE webhook_deliveries
          SET delivery_status = 'failed', retry_count = ?, status_code = ?, response_body = ?, error = ?, duration_ms = ?, next_retry_at = NULL
          WHERE id = ?
        `).run(nextAttempt, statusCode, responseBody, error, durationMs, delivery.id)

        db.prepare(`
          UPDATE webhooks SET last_status = ?, updated_at = unixepoch() WHERE id = ?
        `).run(statusCode ?? -1, delivery.webhook_id)

        exhausted++
      } else {
        // Schedule next retry with exponential backoff
        const delayMs = BACKOFF_DELAYS_MS[nextAttempt] || BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1]
        const nextRetryAt = Math.floor((Date.now() + delayMs) / 1000)

        db.prepare(`
          UPDATE webhook_deliveries
          SET retry_count = ?, status_code = ?, response_body = ?, error = ?, duration_ms = ?, next_retry_at = ?
          WHERE id = ?
        `).run(nextAttempt, statusCode, responseBody, error, durationMs, nextRetryAt, delivery.id)

        retried++
      }
    }

    const parts: string[] = []
    if (succeeded) parts.push(`${succeeded} succeeded`)
    if (retried) parts.push(`${retried} re-queued`)
    if (exhausted) parts.push(`${exhausted} exhausted`)
    return { ok: true, message: `Processed ${pending.length} retries: ${parts.join(', ')}` }
  } catch (err: any) {
    logger.error({ err }, 'Webhook retry processing failed')
    return { ok: false, message: `Retry processing failed: ${err.message}` }
  }
}

/**
 * Manually retry a specific failed delivery.
 */
export async function retryDelivery(deliveryId: number): Promise<{ ok: boolean; message: string }> {
  try {
    const { getDatabase } = await import('./db')
    const db = getDatabase()

    const delivery = db.prepare(`
      SELECT wd.*, w.url, w.secret
      FROM webhook_deliveries wd
      JOIN webhooks w ON wd.webhook_id = w.id
      WHERE wd.id = ?
    `).get(deliveryId) as any

    if (!delivery) return { ok: false, message: 'Delivery not found' }

    // Reset retry state and schedule immediate retry
    db.prepare(`
      UPDATE webhook_deliveries
      SET delivery_status = 'pending_retry', retry_count = 0, max_retries = ?, next_retry_at = ?
      WHERE id = ?
    `).run(MAX_RETRIES, Math.floor(Date.now() / 1000), deliveryId)

    return { ok: true, message: 'Delivery queued for retry' }
  } catch (err: any) {
    return { ok: false, message: `Failed to queue retry: ${err.message}` }
  }
}
