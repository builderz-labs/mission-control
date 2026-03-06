import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getAllGatewaySessions } from '@/lib/sessions'
import { getDatabase } from '@/lib/db'
import { DYNASTY_ROSTER } from '@/data/dynasty-roster'

/**
 * GET /api/fleet - Fleet overview statistics
 * Uses dynasty-roster.ts as canonical agent list.
 * Live status derived from OpenClaw session stores.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const dayAgo = now - 86400
    const weekAgo = now - 604800

    // Derive live agent status from session stores (active within last 5 min)
    const activeSessions = getAllGatewaySessions(5 * 60 * 1000)
    const activeAgentNames = new Set(activeSessions.map(s => s.agent.toLowerCase()))

    // Also check sessions active within 30 min for "idle"
    const recentSessions = getAllGatewaySessions(30 * 60 * 1000)
    const recentAgentNames = new Set(recentSessions.map(s => s.agent.toLowerCase()))

    // Build agent list from dynasty roster with live status
    const agentList = DYNASTY_ROSTER.map(agent => {
      const nameLower = agent.name.toLowerCase()
      let status: 'active' | 'idle' | 'offline'
      if (activeAgentNames.has(nameLower)) {
        status = 'active'
      } else if (recentAgentNames.has(nameLower)) {
        status = 'idle'
      } else {
        status = 'offline'
      }
      return {
        name: agent.name,
        role: agent.role,
        emoji: agent.emoji,
        model: agent.model,
        status,
      }
    })

    const totalAgents = agentList.length
    const activeCount = agentList.filter(a => a.status === 'active').length
    const idleCount = agentList.filter(a => a.status === 'idle').length
    const offlineCount = agentList.filter(a => a.status === 'offline').length

    // Top agents by task completion (from Convex tasks via SQLite if available)
    let topAgentsByCompletion: Array<{
      name: string; role: string; status: string; last_seen: number | null
      completed: number; in_progress: number; total_tasks: number
    }> = []
    try {
      topAgentsByCompletion = db.prepare(`
        SELECT a.name, a.role, a.status, a.last_seen,
          COUNT(CASE WHEN t.status = 'done' THEN 1 END) as completed,
          COUNT(CASE WHEN t.status = 'in_progress' THEN 1 END) as in_progress,
          COUNT(*) as total_tasks
        FROM agents a
        LEFT JOIN tasks t ON t.assigned_to = a.name
        GROUP BY a.id
        HAVING total_tasks > 0
        ORDER BY completed DESC
        LIMIT 10
      `).all() as typeof topAgentsByCompletion
    } catch {
      // Fallback: build from dynasty roster with 0 task counts
      topAgentsByCompletion = agentList.map(a => ({
        name: a.name,
        role: a.role,
        status: a.status,
        last_seen: null,
        completed: 0,
        in_progress: 0,
        total_tasks: 0,
      }))
    }

    // Top agents by token usage
    let topByTokens: Array<{
      agent_name: string; total_tokens: number; total_cost: number; request_count: number
    }> = []
    try {
      topByTokens = db.prepare(`
        SELECT
          SUBSTR(session_id, 1, INSTR(session_id, ':') - 1) as agent_name,
          SUM(total_tokens) as total_tokens,
          SUM(cost) as total_cost,
          COUNT(*) as request_count
        FROM token_usage
        WHERE timestamp >= ?
        GROUP BY agent_name
        ORDER BY total_tokens DESC
        LIMIT 10
      `).all(dayAgo * 1000) as typeof topByTokens
    } catch {
      // token_usage table may not have data
    }

    // Recent activity timeline
    let recentActivities: Array<{
      id: number; type: string; entity_type: string; entity_id: number
      actor: string; description: string; created_at: number
    }> = []
    try {
      recentActivities = db.prepare(`
        SELECT id, type, entity_type, entity_id, actor, description, created_at
        FROM activities
        WHERE created_at >= ?
        ORDER BY created_at DESC
        LIMIT 20
      `).all(dayAgo) as typeof recentActivities
    } catch {
      // activities table may not exist
    }

    // Task summary
    let taskMap: Record<string, number> = {}
    let totalTasks = 0
    try {
      const taskSummary = db.prepare(`
        SELECT status, COUNT(*) as count FROM tasks GROUP BY status
      `).all() as Array<{ status: string; count: number }>
      for (const row of taskSummary) {
        taskMap[row.status] = row.count
        totalTasks += row.count
      }
    } catch {
      // tasks table may not exist
    }

    let completedToday = 0
    try {
      const r = db.prepare(`
        SELECT COUNT(*) as count FROM tasks WHERE status = 'done' AND updated_at >= ?
      `).get(dayAgo) as { count: number }
      completedToday = r.count
    } catch { /* ignore */ }

    let activityCounts = { today: 0, week: 0 }
    try {
      activityCounts = db.prepare(`
        SELECT
          COUNT(CASE WHEN created_at >= ? THEN 1 END) as today,
          COUNT(CASE WHEN created_at >= ? THEN 1 END) as week
        FROM activities
      `).get(dayAgo, weekAgo) as { today: number; week: number }
    } catch { /* ignore */ }

    // Fleet health score
    let healthScore = 100
    if (totalAgents > 0) {
      healthScore -= Math.round((offlineCount / totalAgents) * 30)
    }
    const completedTasks = taskMap['done'] || 0
    if (totalTasks > 0) {
      healthScore += Math.round((completedTasks / totalTasks) * 10)
    }
    healthScore = Math.max(0, Math.min(100, healthScore))

    return NextResponse.json({
      agents: {
        total: totalAgents,
        active: activeCount,
        idle: idleCount,
        offline: offlineCount,
        error: 0,
        statusBreakdown: { active: activeCount, idle: idleCount, offline: offlineCount },
        roster: agentList,
      },
      tasks: {
        total: totalTasks,
        byStatus: taskMap,
        completedToday,
      },
      topAgentsByCompletion,
      topAgentsByTokens: topByTokens,
      recentActivity: recentActivities,
      activityCounts,
      healthScore,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/fleet error')
    return NextResponse.json({ error: 'Failed to fetch fleet overview' }, { status: 500 })
  }
}
