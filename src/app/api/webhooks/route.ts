import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { randomBytes } from 'crypto'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody, createWebhookSchema } from '@/lib/validation'

const WEBHOOK_BLOCKED_HOSTNAMES = new Set([
  'localhost', '127.0.0.1', '::1', '0.0.0.0',
  'metadata.google.internal', 'metadata.internal', 'instance-data',
])

function isBlockedWebhookUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr)
    const hostname = url.hostname
    if (WEBHOOK_BLOCKED_HOSTNAMES.has(hostname)) return true
    if (hostname.endsWith('.local')) return true
    // Block private IPv4 ranges
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
      const parts = hostname.split('.').map(Number)
      if (parts[0] === 10) return true
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
      if (parts[0] === 192 && parts[1] === 168) return true
      if (parts[0] === 169 && parts[1] === 254) return true
      if (parts[0] === 127) return true
    }
    return false
  } catch {
    return true
  }
}

/**
 * GET /api/webhooks - List all webhooks with delivery stats
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const webhooks = db.prepare(`
      SELECT w.*,
        (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id AND wd.workspace_id = w.workspace_id) as total_deliveries,
        (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id AND wd.workspace_id = w.workspace_id AND wd.status_code BETWEEN 200 AND 299) as successful_deliveries,
        (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id AND wd.workspace_id = w.workspace_id AND (wd.error IS NOT NULL OR wd.status_code NOT BETWEEN 200 AND 299)) as failed_deliveries
      FROM webhooks w
      WHERE w.workspace_id = ?
      ORDER BY w.created_at DESC
    `).all(workspaceId) as any[]

    // Parse events JSON, mask secret, add circuit breaker status
    const maxRetries = parseInt(process.env.MC_WEBHOOK_MAX_RETRIES || '5', 10) || 5
    const result = webhooks.map((wh) => ({
      ...wh,
      events: JSON.parse(wh.events || '["*"]'),
      secret: wh.secret ? '••••••' + wh.secret.slice(-4) : null,
      enabled: !!wh.enabled,
      consecutive_failures: wh.consecutive_failures ?? 0,
      circuit_open: (wh.consecutive_failures ?? 0) >= maxRetries,
    }))

    return NextResponse.json({ webhooks: result })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/webhooks error')
    return NextResponse.json({ error: 'Failed to fetch webhooks' }, { status: 500 })
  }
}

/**
 * POST /api/webhooks - Create a new webhook
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const validated = await validateBody(request, createWebhookSchema)
    if ('error' in validated) return validated.error
    const body = validated.data
    const { name, url, events, generate_secret } = body

    if (isBlockedWebhookUrl(url)) {
      return NextResponse.json({ error: 'Webhook URL cannot point to internal or private services' }, { status: 400 })
    }

    const secret = generate_secret !== false ? randomBytes(32).toString('hex') : null
    const eventsJson = JSON.stringify(events || ['*'])

    const dbResult = db.prepare(`
      INSERT INTO webhooks (name, url, secret, events, created_by, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, url, secret, eventsJson, auth.user.username, workspaceId)

    return NextResponse.json({
      id: dbResult.lastInsertRowid,
      name,
      url,
      secret, // Show full secret only on creation
      events: events || ['*'],
      enabled: true,
      message: 'Webhook created. Save the secret - it won\'t be shown again in full.',
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/webhooks error')
    return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 })
  }
}

/**
 * PUT /api/webhooks - Update a webhook
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()
    const { id, name, url, events, enabled, regenerate_secret, reset_circuit } = body

    if (!id) {
      return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 })
    }

    const existing = db.prepare('SELECT * FROM webhooks WHERE id = ? AND workspace_id = ?').get(id, workspaceId) as any
    if (!existing) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    if (url) {
      try { new URL(url) } catch {
        return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
      }
      if (isBlockedWebhookUrl(url)) {
        return NextResponse.json({ error: 'Webhook URL cannot point to internal or private services' }, { status: 400 })
      }
    }

    const updates: string[] = ['updated_at = unixepoch()']
    const params: any[] = []

    if (name !== undefined) { updates.push('name = ?'); params.push(name) }
    if (url !== undefined) { updates.push('url = ?'); params.push(url) }
    if (events !== undefined) { updates.push('events = ?'); params.push(JSON.stringify(events)) }
    if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0) }

    // Reset circuit breaker: clear failure count and re-enable
    if (reset_circuit) {
      updates.push('consecutive_failures = 0')
      updates.push('enabled = 1')
    }

    let newSecret: string | null = null
    if (regenerate_secret) {
      newSecret = randomBytes(32).toString('hex')
      updates.push('secret = ?')
      params.push(newSecret)
    }

    params.push(id, workspaceId)
    db.prepare(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...params)

    return NextResponse.json({
      success: true,
      ...(newSecret ? { secret: newSecret, message: 'New secret generated. Save it now.' } : {}),
    })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/webhooks error')
    return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 })
  }
}

/**
 * DELETE /api/webhooks - Delete a webhook
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    let body: any
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Request body required' }, { status: 400 }) }
    const id = body.id

    if (!id) {
      return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 })
    }

    // Delete deliveries first (cascade should handle it, but be explicit)
    db.prepare('DELETE FROM webhook_deliveries WHERE webhook_id = ? AND workspace_id = ?').run(id, workspaceId)
    const result = db.prepare('DELETE FROM webhooks WHERE id = ? AND workspace_id = ?').run(id, workspaceId)

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, deleted: result.changes })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/webhooks error')
    return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 })
  }
}
