import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

interface AgentPerformance {
  agent: string
  totalTasks: number
  completedTasks: number
  rejectedTasks: number
  successRate: number
  rejectionRate: number
  avgCompletionHours: number | null
  tasksByStatus: Record<string, number>
  recentCompletions: Array<{ title: string; completed_at: number; outcome: string }>
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '30', 10)
    const since = Math.floor(Date.now() / 1000) - days * 86400

    // Get all agents with task stats
    const agents = db.prepare(`
      SELECT DISTINCT assigned_to FROM tasks
      WHERE workspace_id = ? AND assigned_to IS NOT NULL AND assigned_to != ''
    `).all(workspaceId) as Array<{ assigned_to: string }>

    const performances: AgentPerformance[] = []

    for (const { assigned_to: agent } of agents) {
      // Total tasks assigned
      const totalRow = db.prepare(`
        SELECT COUNT(*) as c FROM tasks
        WHERE workspace_id = ? AND assigned_to = ? AND created_at > ?
      `).get(workspaceId, agent, since) as { c: number }

      // Completed tasks
      const completedRow = db.prepare(`
        SELECT COUNT(*) as c FROM tasks
        WHERE workspace_id = ? AND assigned_to = ? AND status = 'done' AND created_at > ?
      `).get(workspaceId, agent, since) as { c: number }

      // Tasks by status
      const statusRows = db.prepare(`
        SELECT status, COUNT(*) as c FROM tasks
        WHERE workspace_id = ? AND assigned_to = ? AND created_at > ?
        GROUP BY status
      `).all(workspaceId, agent, since) as Array<{ status: string; c: number }>

      const tasksByStatus: Record<string, number> = {}
      for (const row of statusRows) {
        tasksByStatus[row.status] = row.c
      }

      // Rejection count from quality_reviews
      const rejectedRow = db.prepare(`
        SELECT COUNT(*) as c FROM quality_reviews qr
        JOIN tasks t ON qr.task_id = t.id
        WHERE t.workspace_id = ? AND t.assigned_to = ? AND qr.status = 'rejected' AND qr.created_at > ?
      `).get(workspaceId, agent, since) as { c: number }

      // Average completion time (created_at to completed_at)
      const avgRow = db.prepare(`
        SELECT AVG(completed_at - created_at) as avg_seconds FROM tasks
        WHERE workspace_id = ? AND assigned_to = ? AND status = 'done'
          AND completed_at IS NOT NULL AND created_at > ?
      `).get(workspaceId, agent, since) as { avg_seconds: number | null }

      // Recent completions
      const recentRows = db.prepare(`
        SELECT title, completed_at, outcome FROM tasks
        WHERE workspace_id = ? AND assigned_to = ? AND status = 'done'
          AND completed_at IS NOT NULL AND created_at > ?
        ORDER BY completed_at DESC LIMIT 5
      `).all(workspaceId, agent, since) as Array<{ title: string; completed_at: number; outcome: string }>

      const total = totalRow.c
      const completed = completedRow.c
      const rejected = rejectedRow.c

      performances.push({
        agent,
        totalTasks: total,
        completedTasks: completed,
        rejectedTasks: rejected,
        successRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        rejectionRate: total > 0 ? Math.round((rejected / total) * 100) : 0,
        avgCompletionHours: avgRow.avg_seconds != null
          ? Math.round((avgRow.avg_seconds / 3600) * 10) / 10
          : null,
        tasksByStatus,
        recentCompletions: recentRows,
      })
    }

    // Sort by completed tasks descending
    performances.sort((a, b) => b.completedTasks - a.completedTasks)

    // Aggregate totals
    const totals = {
      totalTasks: performances.reduce((s, p) => s + p.totalTasks, 0),
      completedTasks: performances.reduce((s, p) => s + p.completedTasks, 0),
      rejectedTasks: performances.reduce((s, p) => s + p.rejectedTasks, 0),
      agents: performances.length,
    }

    return NextResponse.json({ performances, totals, days, generatedAt: new Date().toISOString() })
  } catch (error) {
    logger.error({ err: error }, 'Agent performance API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
