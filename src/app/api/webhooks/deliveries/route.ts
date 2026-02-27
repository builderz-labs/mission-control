import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'

/**
 * GET /api/webhooks/deliveries - Get delivery history for a webhook
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const webhookId = searchParams.get('webhook_id')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')

    let query = `
      SELECT wd.*, w.name as webhook_name, w.url as webhook_url
      FROM webhook_deliveries wd
      JOIN webhooks w ON wd.webhook_id = w.id
    `
    const params: any[] = []

    if (webhookId) {
      query += ' WHERE wd.webhook_id = ?'
      params.push(webhookId)
    }

    query += ' ORDER BY wd.created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const deliveries = db.prepare(query).all(...params)

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM webhook_deliveries'
    const countParams: any[] = []
    if (webhookId) {
      countQuery += ' WHERE webhook_id = ?'
      countParams.push(webhookId)
    }
    const { count: total } = db.prepare(countQuery).get(...countParams) as { count: number }

    return NextResponse.json({ deliveries, total })
  } catch (error) {
    console.error('GET /api/webhooks/deliveries error:', error)
    return NextResponse.json({ error: 'Failed to fetch deliveries' }, { status: 500 })
  }
}
