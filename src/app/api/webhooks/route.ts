import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { randomBytes, createHmac } from 'crypto'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody, createWebhookSchema } from '@/lib/validation'

/**
 * GET /api/webhooks - List all webhooks with delivery stats
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const webhooks = db.prepare(`
      SELECT w.*,
        (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id) as total_deliveries,
        (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id AND wd.status_code BETWEEN 200 AND 299) as successful_deliveries,
        (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id AND (wd.error IS NOT NULL OR wd.status_code NOT BETWEEN 200 AND 299)) as failed_deliveries
      FROM webhooks w
      ORDER BY w.created_at DESC
    `).all() as any[]

    // Parse events JSON, mask secret
    const result = webhooks.map((wh) => ({
      ...wh,
      events: JSON.parse(wh.events || '["*"]'),
      secret: wh.secret ? '••••••' + wh.secret.slice(-4) : null,
      enabled: !!wh.enabled,
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
    const validated = await validateBody(request, createWebhookSchema)
    if ('error' in validated) return validated.error
    const body = validated.data
    const { name, url, events, generate_secret } = body

    const secret = generate_secret !== false ? randomBytes(32).toString('hex') : null
    const eventsJson = JSON.stringify(events || ['*'])

    const dbResult = db.prepare(`
      INSERT INTO webhooks (name, url, secret, events, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, url, secret, eventsJson, auth.user.username)

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
    const body = await request.json()
    const { id, name, url, events, enabled, regenerate_secret } = body

    if (!id) {
      return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 })
    }

    const existing = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as any
    if (!existing) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    if (url) {
      try { new URL(url) } catch {
        return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
      }
    }

    const updates: string[] = ['updated_at = unixepoch()']
    const params: any[] = []

    if (name !== undefined) { updates.push('name = ?'); params.push(name) }
    if (url !== undefined) { updates.push('url = ?'); params.push(url) }
    if (events !== undefined) { updates.push('events = ?'); params.push(JSON.stringify(events)) }
    if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0) }

    let newSecret: string | null = null
    if (regenerate_secret) {
      newSecret = randomBytes(32).toString('hex')
      updates.push('secret = ?')
      params.push(newSecret)
    }

    params.push(id)
    db.prepare(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?`).run(...params)

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
    let body: any
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Request body required' }, { status: 400 }) }
    const id = body.id

    if (!id) {
      return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 })
    }

    // Delete deliveries first (cascade should handle it, but be explicit)
    db.prepare('DELETE FROM webhook_deliveries WHERE webhook_id = ?').run(id)
    const result = db.prepare('DELETE FROM webhooks WHERE id = ?').run(id)

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, deleted: result.changes })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/webhooks error')
    return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 })
  }
}
