import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

interface InboundWebhook {
  id: number
  name: string
  slug: string
  secret: string
  enabled: number
  allowed_events: string
  source_ip_allowlist: string | null
  last_received_at: number | null
  created_at: number
  updated_at: number
}

/**
 * GET /api/webhooks/inbound/manage - List all inbound webhooks
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const webhooks = db.prepare('SELECT * FROM inbound_webhooks ORDER BY created_at DESC').all() as InboundWebhook[]

    // Redact secrets, parse JSON fields
    const result = webhooks.map((wh) => ({
      ...wh,
      secret: wh.secret ? '••••••••' : '',
      secret_set: !!wh.secret,
      allowed_events: safeParseJSON(wh.allowed_events, ['*']),
      source_ip_allowlist: safeParseJSON(wh.source_ip_allowlist, []),
    }))

    return NextResponse.json({ webhooks: result })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/webhooks/inbound/manage error')
    return NextResponse.json({ error: 'Failed to fetch inbound webhooks' }, { status: 500 })
  }
}

/**
 * POST /api/webhooks/inbound/manage - Create an inbound webhook
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const body = await request.json()
    const { name, slug, allowed_events, source_ip_allowlist } = body

    if (!name || !slug) {
      return NextResponse.json({ error: 'name and slug are required' }, { status: 400 })
    }

    // Validate slug format (alphanumeric + hyphens only)
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && !/^[a-z0-9]$/.test(slug)) {
      return NextResponse.json({ error: 'slug must be lowercase alphanumeric with hyphens (e.g., "github-events")' }, { status: 400 })
    }

    // Generate a secure secret
    const secret = randomBytes(32).toString('hex')

    const result = db.prepare(`
      INSERT INTO inbound_webhooks (name, slug, secret, allowed_events, source_ip_allowlist)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      name,
      slug,
      secret,
      JSON.stringify(allowed_events || ['*']),
      source_ip_allowlist ? JSON.stringify(source_ip_allowlist) : null
    )

    const created = db.prepare('SELECT * FROM inbound_webhooks WHERE id = ?').get(result.lastInsertRowid) as InboundWebhook

    return NextResponse.json({
      webhook: {
        ...created,
        allowed_events: safeParseJSON(created.allowed_events, ['*']),
        source_ip_allowlist: safeParseJSON(created.source_ip_allowlist, []),
      },
      // Show the secret only on creation
      secret,
      endpoint: `/api/webhooks/inbound?slug=${slug}`,
    }, { status: 201 })
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'An inbound webhook with that slug already exists' }, { status: 409 })
    }
    logger.error({ err }, 'POST /api/webhooks/inbound/manage error')
    return NextResponse.json({ error: 'Failed to create inbound webhook' }, { status: 500 })
  }
}

/**
 * PUT /api/webhooks/inbound/manage - Update an inbound webhook
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const existing = db.prepare('SELECT * FROM inbound_webhooks WHERE id = ?').get(id) as InboundWebhook | undefined
    if (!existing) return NextResponse.json({ error: 'Inbound webhook not found' }, { status: 404 })

    const sets: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name) }
    if (updates.enabled !== undefined) { sets.push('enabled = ?'); values.push(updates.enabled ? 1 : 0) }
    if (updates.allowed_events !== undefined) { sets.push('allowed_events = ?'); values.push(JSON.stringify(updates.allowed_events)) }
    if (updates.source_ip_allowlist !== undefined) {
      sets.push('source_ip_allowlist = ?')
      values.push(updates.source_ip_allowlist ? JSON.stringify(updates.source_ip_allowlist) : null)
    }

    // Regenerate secret if requested
    let newSecret: string | undefined
    if (updates.regenerate_secret) {
      newSecret = randomBytes(32).toString('hex')
      sets.push('secret = ?')
      values.push(newSecret)
    }

    if (sets.length === 0) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })

    sets.push('updated_at = unixepoch()')
    values.push(id)

    db.prepare(`UPDATE inbound_webhooks SET ${sets.join(', ')} WHERE id = ?`).run(...values)

    const updated = db.prepare('SELECT * FROM inbound_webhooks WHERE id = ?').get(id) as InboundWebhook

    const response: any = {
      webhook: {
        ...updated,
        secret: updated.secret ? '••••••••' : '',
        secret_set: !!updated.secret,
        allowed_events: safeParseJSON(updated.allowed_events, ['*']),
        source_ip_allowlist: safeParseJSON(updated.source_ip_allowlist, []),
      },
    }

    if (newSecret) response.secret = newSecret

    return NextResponse.json(response)
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/webhooks/inbound/manage error')
    return NextResponse.json({ error: 'Failed to update inbound webhook' }, { status: 500 })
  }
}

/**
 * DELETE /api/webhooks/inbound/manage - Delete an inbound webhook
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    let body: any
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Request body required' }, { status: 400 }) }
    const { id } = body

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    // Delete deliveries first
    db.prepare('DELETE FROM inbound_webhook_deliveries WHERE webhook_id = ?').run(id)
    const result = db.prepare('DELETE FROM inbound_webhooks WHERE id = ?').run(id)

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Inbound webhook not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, deleted: result.changes })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/webhooks/inbound/manage error')
    return NextResponse.json({ error: 'Failed to delete inbound webhook' }, { status: 500 })
  }
}

function safeParseJSON(value: string | null, fallback: any): any {
  if (!value) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}
