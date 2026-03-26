import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

/**
 * POST /api/agents/halt - Emergency circuit breaker: set ALL agents to offline
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const workspaceId = auth.user.workspace_id ?? 1

    // Set all non-offline agents to offline and record the timestamp
    const result = db
      .prepare(
        `UPDATE agents
         SET status = 'offline', last_seen = ?, updated_at = ?
         WHERE workspace_id = ? AND status != 'offline'`
      )
      .run(now, now, workspaceId)

    return NextResponse.json({
      success: true,
      halted_count: result.changes,
      timestamp: now,
    })
  } catch (err) {
    logger.error({ err }, 'POST /api/agents/halt error')
    return NextResponse.json(
      {
        error: 'Failed to halt agents',
        detail: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
