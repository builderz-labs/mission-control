import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

/**
 * GET /api/tasks/mine?agent=bnb-hero
 * Returns tasks assigned to this agent, ordered by urgency.
 * This is the agent's work queue — called on each heartbeat.
 *
 * TODO(security): requireRole validates the caller is authenticated, but does
 * not verify that the caller *is* the agent named in ?agent=. Any authenticated
 * user with 'viewer' role can query any agent's queue. Once per-agent identity
 * tokens are in place, add a check that auth.user.agent_id === agent param.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const { searchParams } = new URL(request.url)
    const agent = searchParams.get('agent')

    if (!agent) {
      return NextResponse.json({ error: 'agent parameter is required' }, { status: 400 })
    }

    const statusFilter = searchParams.get('status') || 'assigned,in_progress,review'
    const statuses = statusFilter.split(',').map(s => s.trim())
    const placeholders = statuses.map(() => '?').join(',')

    const tasks = db.prepare(`
      SELECT t.id, t.title, t.description, t.status, t.priority, t.priority_tier,
             t.due_date, t.context_note, t.definition_of_done,
             t.sla_status, t.blocked_type, t.blocked_reason,
             t.retry_count, t.max_retries, t.ack_at, t.first_artifact_at,
             t.created_at, t.updated_at,
             p.name as project_name, p.slug as project_slug
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.workspace_id = ?
        AND t.assigned_to = ?
        AND t.status IN (${placeholders})
      ORDER BY
        CASE t.priority_tier WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
        t.due_date ASC NULLS LAST,
        t.created_at ASC
    `).all(workspaceId, agent, ...statuses) as any[]

    const tasksFormatted = tasks.map(t => ({
      ...t,
      comments_count: 0,
      project: t.project_name ? { name: t.project_name, slug: t.project_slug } : null,
    }))

    // Summary stats
    const now = Math.floor(Date.now() / 1000)
    const total = tasksFormatted.length
    const blocked = tasksFormatted.filter(t => t.blocked_type).length
    const overdue = tasksFormatted.filter(t => t.due_date && t.due_date < now).length
    const atRisk = tasksFormatted.filter(t => t.sla_status === 'at_risk').length

    return NextResponse.json({
      tasks: tasksFormatted,
      summary: {
        total_assigned: total,
        blocked,
        overdue,
        sla_at_risk: atRisk,
      },
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/mine error')
    return NextResponse.json({ error: 'Failed to fetch agent tasks' }, { status: 500 })
  }
}
