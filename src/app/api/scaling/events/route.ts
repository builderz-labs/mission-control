import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import type { ScalingEvent } from '@/lib/scaling-engine'

/**
 * GET /api/scaling/events - List scaling events
 * Optional filters: ?status=pending, ?policy_id=X, ?limit=50
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const url = new URL(request.url)

    const status = url.searchParams.get('status')
    const policyId = url.searchParams.get('policy_id')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)
    const offset = parseInt(url.searchParams.get('offset') || '0', 10)

    let query = 'SELECT * FROM scaling_events WHERE workspace_id = ?'
    const params: (string | number)[] = [workspaceId]

    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }

    if (policyId) {
      query += ' AND policy_id = ?'
      params.push(parseInt(policyId, 10))
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const events = db.prepare(query).all(...params) as ScalingEvent[]

    const countQuery = status
      ? policyId
        ? 'SELECT COUNT(*) as count FROM scaling_events WHERE workspace_id = ? AND status = ? AND policy_id = ?'
        : 'SELECT COUNT(*) as count FROM scaling_events WHERE workspace_id = ? AND status = ?'
      : policyId
        ? 'SELECT COUNT(*) as count FROM scaling_events WHERE workspace_id = ? AND policy_id = ?'
        : 'SELECT COUNT(*) as count FROM scaling_events WHERE workspace_id = ?'

    const countParams: (string | number)[] = [workspaceId]
    if (status) countParams.push(status)
    if (policyId) countParams.push(parseInt(policyId, 10))

    const totalRow = db.prepare(countQuery).get(...countParams) as { count: number }

    return NextResponse.json({ events, total: totalRow.count, limit, offset })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/scaling/events error')
    return NextResponse.json({ error: 'Failed to fetch scaling events' }, { status: 500 })
  }
}
