import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

function safeParseJson(str: string): any {
  try { return JSON.parse(str) } catch { return str }
}

/**
 * GET /api/audit - Query audit log (admin only)
 * Query params: action, actor, limit, offset, since, until
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')
  const actor = searchParams.get('actor')
  const limit = Math.min(parseInt(searchParams.get('limit') || '1000'), 10000)
  const offset = parseInt(searchParams.get('offset') || '0')
  const since = searchParams.get('since')
  const until = searchParams.get('until')

  const conditions: string[] = []
  const params: any[] = []

  if (action) {
    conditions.push('action = ?')
    params.push(action)
  }
  if (actor) {
    conditions.push('actor = ?')
    params.push(actor)
  }
  if (since) {
    conditions.push('created_at >= ?')
    params.push(parseInt(since))
  }
  if (until) {
    conditions.push('created_at <= ?')
    params.push(parseInt(until))
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const db = getDatabase()

  const total = (db.prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`).get(...params) as { count: number }).count

  interface AuditLogRow {
    id: number
    action: string
    actor: string
    actor_id: number | null
    target_type: string | null
    target_id: number | null
    detail: string | null
    ip_address: string | null
    user_agent: string | null
    created_at: number
  }

  const rows = db.prepare(`
    SELECT * FROM audit_log ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as AuditLogRow[]

  return NextResponse.json({
    events: rows.map((row) => ({
      ...row,
      detail: row.detail ? safeParseJson(row.detail) : null,
    })),
    total,
    limit,
    offset,
  })
}
