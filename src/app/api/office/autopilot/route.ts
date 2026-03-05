import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

    const runs = db.prepare(`
      SELECT id, cycle_type, routed_model, routed_agent, summary,
             tasks_scanned, blocked_found, approvals_pending, escalations_created,
             metadata, created_at
      FROM office_autopilot_runs
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(limit) as any[]

    return NextResponse.json({
      runs: runs.map((r) => ({
        ...r,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
      })),
      total: runs.length,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/office/autopilot error')
    return NextResponse.json({ error: 'Failed to fetch office autopilot runs' }, { status: 500 })
  }
}
