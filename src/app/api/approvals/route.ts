import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { isMainTask, normalizeTaskStatus } from '@/lib/task-workflow'

/**
 * GET /api/approvals
 * Returns tasks requiring explicit user decision.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

    const tasks = db.prepare(`
      SELECT * FROM tasks
      WHERE status IN ('needs-approval', 'review')
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as any[]

    const latestApprovalStmt = db.prepare(`
      SELECT id, action, summary, rationale, actor, created_at
      FROM task_approvals
      WHERE task_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `)

    const pending = tasks
      .map((task) => {
        const metadata = task.metadata ? JSON.parse(task.metadata) : {}
        const normalizedStatus = normalizeTaskStatus(task.status)
        const latest = latestApprovalStmt.get(task.id) as any
        const requiresDecision =
          normalizedStatus === 'needs-approval' ||
          (normalizedStatus === 'review' && isMainTask(metadata) && latest?.action !== 'approve')

        return {
          ...task,
          status: normalizedStatus,
          tags: task.tags ? JSON.parse(task.tags) : [],
          metadata,
          latestApproval: latest || null,
          requiresDecision,
        }
      })
      .filter((task) => task.requiresDecision)

    return NextResponse.json({ approvals: pending, total: pending.length })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/approvals error')
    return NextResponse.json({ error: 'Failed to fetch approvals' }, { status: 500 })
  }
}
