import { createHmac, timingSafeEqual } from 'crypto'
import { eventBus, type ServerEvent } from './event-bus'
import { logger } from './logger'

interface Webhook {
  id: number
  name: string
  url: string
  secret: string | null
  events: string // JSON array
  enabled: number
  workspace_id?: number
  consecutive_failures?: number
}

interface DeliverOpts {
  attempt?: number
  parentDeliveryId?: number | null
  allowRetry?: boolean
}

interface DeliveryResult {
  success: boolean
  status_code: number | null
  response_body: string | null
  error: string | null
  duration_ms: number
  delivery_id?: number
}

// Backoff schedule in seconds: 30s, 5m, 30m, 2h, 8h
const BACKOFF_SECONDS = [30, 300, 1800, 7200, 28800]

const MAX_RETRIES = parseInt(process.env.MC_WEBHOOK_MAX_RETRIES || '5', 10) || 5

// Map event bus events to webhook event types
const EVENT_MAP: Record<string, string> = {
  'activity.created': 'activity',         // Dynamically becomes activity.<type>
  'notification.created': 'notification',  // Dynamically becomes notification.<type>
  'agent.status_changed': 'agent.status_change',
  'audit.security': 'security',           // Dynamically becomes security.<action>
  'task.created': 'activity.task_created',
  'task.updated': 'activity.task_updated',
  'task.deleted': 'activity.task_deleted',
  'task.status_changed': 'activity.task_status_changed',
}

/**
 * Compute the next retry delay in seconds, with ±20% jitter.
 */
export function nextRetryDelay(attempt: number): number {
  const base = BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)]
  const jitter = base * 0.2 * (2 * Math.random() - 1) // ±20%
  return Math.round(base + jitter)
}

/**
 * Verify a webhook signature using constant-time comparison.
 * Consumers can use this to validate incoming webhook deliveries.
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null | undefined
): boolean {
  if (!signatureHeader || !secret) return false

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`

  // Constant-time comparison
  const sigBuf = Buffer.from(signatureHeader)
  const expectedBuf = Buffer.from(expected)

  if (sigBuf.length !== expectedBuf.length) {
    // Compare expected against a dummy buffer of matching length to avoid timing leak
    const dummy = Buffer.alloc(expectedBuf.length)
    timingSafeEqual(expectedBuf, dummy)
    return false
  }

  return timingSafeEqual(sigBuf, expectedBuf)
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
    const workspaceId = typeof event.data?.workspace_id === 'number' ? event.data.workspace_id : 1

    fireWebhooksAsync(webhookEventType, event.data, workspaceId).catch((err) => {
      logger.error({ err }, 'Webhook dispatch error')
    })

    if (isAgentError) {
      fireWebhooksAsync('agent.error', event.data, workspaceId).catch((err) => {
        logger.error({ err }, 'Webhook dispatch error')
      })
    }
  })
}

/**
 * Fire all matching webhooks for an event type (public for test endpoint).
 */
export function fireWebhooks(eventType: string, payload: Record<string, any>, workspaceId?: number) {
  fireWebhooksAsync(eventType, payload, workspaceId).catch((err) => {
    logger.error({ err }, 'Webhook dispatch error')
  })
}

async function fireWebhooksAsync(eventType: string, payload: Record<string, any>, workspaceId?: number) {
  const resolvedWorkspaceId =
    workspaceId ?? (typeof payload?.workspace_id === 'number' ? payload.workspace_id : 1)
  let webhooks: Webhook[]
  try {
    // Lazy import to avoid circular dependency
    const { getDatabase } = await import('./db')
    const db = getDatabase()
    webhooks = db.prepare(
      'SELECT * FROM webhooks WHERE enabled = 1 AND workspace_id = ?'
    ).all(resolvedWorkspaceId) as Webhook[]
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
    matchingWebhooks.map((wh) => deliverWebhook(wh, eventType, payload, { allowRetry: true }))
  )
}

/**
 * Public wrapper for API routes (test endpoint, manual retry).
 * Returns delivery result fields for the response.
 */
export async function deliverWebhookPublic(
  webhook: Webhook,
  eventType: string,
  payload: Record<string, any>,
  opts?: DeliverOpts
): Promise<DeliveryResult> {
  return deliverWebhook(webhook, eventType, payload, opts ?? { allowRetry: false })
}

async function deliverWebhook(
  webhook: Webhook,
  eventType: string,
  payload: Record<string, any>,
  opts: DeliverOpts = {}
): Promise<DeliveryResult> {
  const { attempt = 0, parentDeliveryId = null, allowRetry = true } = opts

  const body = JSON.stringify({
    event: eventType,
    timestamp: Math.floor(Date.now() / 1000),
    data: payload,
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'MissionControl-Webhook/1.0',
    'X-MC-Event': eventType,
  }

  // HMAC signature if secret is configured
  if (webhook.secret) {
    const sig = createHmac('sha256', webhook.secret).update(body).digest('hex')
    headers['X-MC-Signature'] = `sha256=${sig}`
  }

  const start = Date.now()
  let statusCode: number | null = null
  let responseBody: string | null = null
  let error: string | null = null

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(webhook.url, {
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

  const durationMs = Date.now() - start
  const success = statusCode !== null && statusCode >= 200 && statusCode < 300
  let deliveryId: number | undefined

  // Log delivery attempt and handle retry/circuit-breaker logic
  try {
    const { getDatabase } = await import('./db')
    const db = getDatabase()

    const insertResult = db.prepare(`
      INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status_code, response_body, error, duration_ms, attempt, is_retry, parent_delivery_id, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      webhook.id,
      eventType,
      body,
      statusCode,
      responseBody,
      error,
      durationMs,
      attempt,
      attempt > 0 ? 1 : 0,
      parentDeliveryId,
      webhook.workspace_id ?? 1
    )
    deliveryId = Number(insertResult.lastInsertRowid)

    // Update webhook last_fired
    db.prepare(`
      UPDATE webhooks SET last_fired_at = unixepoch(), last_status = ?, updated_at = unixepoch()
      WHERE id = ? AND workspace_id = ?
    `).run(statusCode ?? -1, webhook.id, webhook.workspace_id ?? 1)

    // Circuit breaker + retry scheduling (skip for test deliveries)
    if (allowRetry) {
      if (success) {
        // Reset consecutive failures on success
        db.prepare(`UPDATE webhooks SET consecutive_failures = 0 WHERE id = ? AND workspace_id = ?`).run(webhook.id, webhook.workspace_id ?? 1)
      } else {
        // Increment consecutive failures
        db.prepare(`UPDATE webhooks SET consecutive_failures = consecutive_failures + 1 WHERE id = ? AND workspace_id = ?`).run(webhook.id, webhook.workspace_id ?? 1)

        if (attempt < MAX_RETRIES - 1) {
          // Schedule retry
          const delaySec = nextRetryDelay(attempt)
          const nextRetryAt = Math.floor(Date.now() / 1000) + delaySec
          db.prepare(`UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = ?`).run(nextRetryAt, deliveryId)
        } else {
          // Exhausted retries — trip circuit breaker
          const wh = db.prepare(`SELECT consecutive_failures FROM webhooks WHERE id = ? AND workspace_id = ?`).get(webhook.id, webhook.workspace_id ?? 1) as { consecutive_failures: number } | undefined
          if (wh && wh.consecutive_failures >= MAX_RETRIES) {
            db.prepare(`UPDATE webhooks SET enabled = 0, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?`).run(webhook.id, webhook.workspace_id ?? 1)
            logger.warn({ webhookId: webhook.id, name: webhook.name }, 'Webhook circuit breaker tripped — disabled after exhausting retries')
          }
        }
      }
    }

    // Prune old deliveries (keep last 200 per webhook)
    db.prepare(`
      DELETE FROM webhook_deliveries
      WHERE webhook_id = ? AND workspace_id = ? AND id NOT IN (
        SELECT id FROM webhook_deliveries WHERE webhook_id = ? AND workspace_id = ? ORDER BY created_at DESC LIMIT 200
      )
    `).run(webhook.id, webhook.workspace_id ?? 1, webhook.id, webhook.workspace_id ?? 1)
  } catch (logErr) {
    logger.error({ err: logErr, webhookId: webhook.id }, 'Webhook delivery logging/pruning failed')
  }

  return { success, status_code: statusCode, response_body: responseBody, error, duration_ms: durationMs, delivery_id: deliveryId }
}

/**
 * Process pending webhook retries. Called by the scheduler.
 * Picks up deliveries where next_retry_at has passed and re-delivers them.
 */
export async function processWebhookRetries(): Promise<{ ok: boolean; message: string }> {
  try {
    const { getDatabase } = await import('./db')
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)

    // Find deliveries ready for retry (limit batch to 50)
    const pendingRetries = db.prepare(`
      SELECT wd.id, wd.webhook_id, wd.event_type, wd.payload, wd.attempt,
             w.id as w_id, w.name as w_name, w.url as w_url, w.secret as w_secret,
             w.events as w_events, w.enabled as w_enabled, w.consecutive_failures as w_consecutive_failures,
             wd.workspace_id as wd_workspace_id
      FROM webhook_deliveries wd
      JOIN webhooks w ON w.id = wd.webhook_id AND w.workspace_id = wd.workspace_id AND w.enabled = 1
      WHERE wd.next_retry_at IS NOT NULL AND wd.next_retry_at <= ?
      LIMIT 50
    `).all(now) as Array<{
      id: number; webhook_id: number; event_type: string; payload: string; attempt: number
      w_id: number; w_name: string; w_url: string; w_secret: string | null
      w_events: string; w_enabled: number; w_consecutive_failures: number; wd_workspace_id: number
    }>

    if (pendingRetries.length === 0) {
      return { ok: true, message: 'No pending retries' }
    }

    // Clear next_retry_at immediately to prevent double-processing
    const clearStmt = db.prepare(`UPDATE webhook_deliveries SET next_retry_at = NULL WHERE id = ? AND workspace_id = ?`)
    for (const row of pendingRetries) {
      clearStmt.run(row.id, row.wd_workspace_id)
    }

    // Re-deliver each
    let succeeded = 0
    let failed = 0
    for (const row of pendingRetries) {
      const webhook: Webhook = {
        id: row.w_id,
        name: row.w_name,
        url: row.w_url,
        secret: row.w_secret,
        events: row.w_events,
        enabled: row.w_enabled,
        consecutive_failures: row.w_consecutive_failures,
        workspace_id: row.wd_workspace_id,
      }

      // Parse the original payload from the stored JSON body
      let parsedPayload: Record<string, any>
      try {
        const parsed = JSON.parse(row.payload)
        parsedPayload = parsed.data ?? parsed
      } catch {
        parsedPayload = {}
      }

      const result = await deliverWebhook(webhook, row.event_type, parsedPayload, {
        attempt: row.attempt + 1,
        parentDeliveryId: row.id,
        allowRetry: true,
      })

      if (result.success) succeeded++
      else failed++
    }

    return { ok: true, message: `Processed ${pendingRetries.length} retries (${succeeded} ok, ${failed} failed)` }
  } catch (err: any) {
    return { ok: false, message: `Webhook retry failed: ${err.message}` }
  }
}
