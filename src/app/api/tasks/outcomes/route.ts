import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

type Outcome = 'success' | 'failed' | 'partial' | 'abandoned'

function resolveSince(timeframe: string): number {
  const now = Math.floor(Date.now() / 1000)
  switch (timeframe) {
    case 'day':
      return now - 24 * 60 * 60
    case 'week':
      return now - 7 * 24 * 60 * 60
    case 'month':
      return now - 30 * 24 * 60 * 60
    case 'all':
    default:
      return 0
  }
}

function outcomeBuckets() {
  return {
    success: 0,
    failed: 0,
    partial: 0,
    abandoned: 0,
    unknown: 0,
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)
    const timeframe = (searchParams.get('timeframe') || 'all').trim().toLowerCase()
    const since = resolveSince(timeframe)

    const db = getDatabase()
    const rows = db.prepare(`
      SELECT
        id,
        assigned_to,
        priority,
        outcome,
        error_message,
        retry_count,
        created_at,
        completed_at
      FROM tasks
      WHERE workspace_id = ?
        AND status = 'done'
        AND (? = 0 OR COALESCE(completed_at, updated_at) >= ?)
    `).all(workspaceId, since, since) as Array<{
      id: number
      assigned_to?: string | null
      priority?: string | null
      outcome?: string | null
      error_message?: string | null
      retry_count?: number | null
      created_at?: number | null
      completed_at?: number | null
    }>

    const summary = {
      total_done: rows.length,
      with_outcome: 0,
      by_outcome: outcomeBuckets(),
      avg_retry_count: 0,
      avg_time_to_resolution_seconds: 0,
      success_rate: 0,
    }

    const byAgent: Record<string, ReturnType<typeof outcomeBuckets> & { total: number; success_rate: number }> = {}
    const byPriority: Record<string, ReturnType<typeof outcomeBuckets> & { total: number; success_rate: number }> = {}
    const errorMap = new Map<string, number>()

    let totalRetryCount = 0
    let totalResolutionSeconds = 0
    let resolutionCount = 0

    for (const row of rows) {
      const outcome = (row.outcome || 'unknown') as Outcome | 'unknown'
      const assignedTo = row.assigned_to || 'unassigned'
      const priority = row.priority || 'unknown'
      const retryCount = Number.isFinite(row.retry_count) ? Number(row.retry_count) : 0

      if (outcome !== 'unknown') summary.with_outcome += 1
      if (outcome in summary.by_outcome) {
        summary.by_outcome[outcome as keyof typeof summary.by_outcome] += 1
      } else {
        summary.by_outcome.unknown += 1
      }

      if (!byAgent[assignedTo]) {
        byAgent[assignedTo] = { ...outcomeBuckets(), total: 0, success_rate: 0 }
      }
      byAgent[assignedTo].total += 1
      if (outcome in byAgent[assignedTo]) {
        byAgent[assignedTo][outcome as keyof ReturnType<typeof outcomeBuckets>] += 1
      } else {
        byAgent[assignedTo].unknown += 1
      }

      if (!byPriority[priority]) {
        byPriority[priority] = { ...outcomeBuckets(), total: 0, success_rate: 0 }
      }
      byPriority[priority].total += 1
      if (outcome in byPriority[priority]) {
        byPriority[priority][outcome as keyof ReturnType<typeof outcomeBuckets>] += 1
      } else {
        byPriority[priority].unknown += 1
      }

      totalRetryCount += retryCount

      if (row.completed_at && row.created_at && row.completed_at >= row.created_at) {
        totalResolutionSeconds += (row.completed_at - row.created_at)
        resolutionCount += 1
      }

      const errorMessage = (row.error_message || '').trim()
      if (errorMessage) {
        errorMap.set(errorMessage, (errorMap.get(errorMessage) || 0) + 1)
      }
    }

    summary.avg_retry_count = rows.length > 0 ? totalRetryCount / rows.length : 0
    summary.avg_time_to_resolution_seconds = resolutionCount > 0 ? totalResolutionSeconds / resolutionCount : 0
    summary.success_rate = summary.with_outcome > 0 ? summary.by_outcome.success / summary.with_outcome : 0

    for (const agent of Object.values(byAgent)) {
      const withOutcome = agent.total - agent.unknown
      agent.success_rate = withOutcome > 0 ? agent.success / withOutcome : 0
    }

    for (const priority of Object.values(byPriority)) {
      const withOutcome = priority.total - priority.unknown
      priority.success_rate = withOutcome > 0 ? priority.success / withOutcome : 0
    }

    const commonErrors = [...errorMap.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([error_message, count]) => ({ error_message, count }))

    return NextResponse.json({
      timeframe,
      summary,
      by_agent: byAgent,
      by_priority: byPriority,
      common_errors: commonErrors,
      record_count: rows.length,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/outcomes error')
    return NextResponse.json({ error: 'Failed to fetch task outcomes' }, { status: 500 })
  }
}
