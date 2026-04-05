import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { readLimiter } from '@/lib/rate-limit'

export interface TaskSummary {
  task_id: number
  session_id: string | null
  step_count: number
  started_at: number
  ended_at: number
}

/**
 * GET /api/exec-replay/tasks
 * List distinct tasks that have execution traces, most recent first.
 * Returns up to 50 task summaries for the caller's workspace.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const limit = readLimiter(request)
  if (limit) return limit

  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1
  const db = getDatabase()

  const rows = db.prepare(`
    SELECT
      task_id,
      session_id,
      COUNT(*) AS step_count,
      MIN(created_at) AS started_at,
      MAX(created_at) AS ended_at
    FROM execution_traces
    WHERE workspace_id = ?
    GROUP BY task_id
    ORDER BY started_at DESC
    LIMIT 50
  `).all(workspaceId) as TaskSummary[]

  return NextResponse.json({ success: true, data: rows })
}
