import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

interface AgentRow {
  id: number
  name: string
  role: string
  status: string
  last_seen: number | null
  last_activity: string | null
  config: string | null
}

interface TaskStatRow {
  assigned_to: string
  active: number | null
  done: number | null
}

/**
 * GET /api/agents/status - Aggregated agent status summary for the dashboard
 * Query params: status, subsystem
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const workspaceId = auth.user.workspace_id ?? 1

    const statusFilter = searchParams.get('status')
    const subsystemFilter = searchParams.get('subsystem')

    const agents = db
      .prepare(
        `SELECT id, name, role, status, last_seen, last_activity, config
         FROM agents
         WHERE workspace_id = ? AND hidden = 0
         ORDER BY
           CASE status
             WHEN 'error'   THEN 0
             WHEN 'busy'    THEN 1
             WHEN 'idle'    THEN 2
             WHEN 'offline' THEN 3
             ELSE 4
           END,
           name ASC`
      )
      .all(workspaceId) as AgentRow[]

    // Fetch task counts for all agents in one query (avoids N+1)
    const taskStatsByAgent = new Map<string, { active: number; done: number }>()

    if (agents.length > 0) {
      const taskRows = db
        .prepare(
          `SELECT
             assigned_to,
             SUM(CASE WHEN status IN ('assigned', 'in_progress') THEN 1 ELSE 0 END) as active,
             SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
           FROM tasks
           WHERE workspace_id = ?
           GROUP BY assigned_to`
        )
        .all(workspaceId) as TaskStatRow[]

      for (const row of taskRows) {
        taskStatsByAgent.set(row.assigned_to, {
          active: row.active ?? 0,
          done: row.done ?? 0,
        })
      }
    }

    // Build agent list with optional filters applied
    const mappedAgents = agents
      .map((agent) => {
        const parsedConfig: Record<string, unknown> = agent.config
          ? (JSON.parse(agent.config) as Record<string, unknown>)
          : {}
        const subsystem =
          typeof parsedConfig.subsystem === 'string' ? parsedConfig.subsystem : 'mission-control'
        const taskStats = taskStatsByAgent.get(agent.name) ?? { active: 0, done: 0 }

        // Determine whether a recent error exists (status is 'error')
        const error_recent = agent.status === 'error'

        return {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          status: agent.status,
          last_seen: agent.last_seen,
          last_activity: agent.last_activity,
          subsystem,
          task_count_active: taskStats.active,
          task_count_done: taskStats.done,
          error_recent,
        }
      })
      .filter((agent) => {
        if (statusFilter && agent.status !== statusFilter) return false
        if (subsystemFilter && agent.subsystem !== subsystemFilter) return false
        return true
      })

    // Build summary counts — 'busy' maps to 'running'
    const summary = {
      total: mappedAgents.length,
      running: mappedAgents.filter((a) => a.status === 'running' || a.status === 'busy').length,
      idle: mappedAgents.filter((a) => a.status === 'idle').length,
      offline: mappedAgents.filter((a) => a.status === 'offline').length,
      error: mappedAgents.filter((a) => a.status === 'error').length,
      last_updated: Math.floor(Date.now() / 1000),
    }

    return NextResponse.json({ summary, agents: mappedAgents })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/status error')
    return NextResponse.json({ error: 'Failed to fetch agent status' }, { status: 500 })
  }
}
