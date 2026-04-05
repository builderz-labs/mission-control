import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { readLimiter } from '@/lib/rate-limit'

interface ExecutionTrace {
  id: number
  task_id: number | null
  session_id: string | null
  step_type: string
  step_data: string
  tokens_used: number | null
  duration_ms: number | null
  success: number
  workspace_id: number
  created_at: number
}

interface ReplayBookmark {
  id: number
  task_id: number
  trace_id: number
  step_index: number
  label: string | null
  note: string | null
  created_by: string
  workspace_id: number
  created_at: number
}

interface RouteContext {
  params: Promise<{ taskId: string }>
}

/**
 * GET /api/exec-replay/trace/[taskId]
 * Fetch execution trace steps for a task, joined with any bookmarks.
 */
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const limit = readLimiter(request)
  if (limit) return limit

  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1
  const { taskId } = await context.params
  const taskIdNum = parseInt(taskId, 10)

  if (Number.isNaN(taskIdNum)) {
    return NextResponse.json({ error: 'Invalid task id' }, { status: 400 })
  }

  const db = getDatabase()

  const steps = db.prepare(`
    SELECT id, task_id, session_id, step_type, step_data,
           tokens_used, duration_ms, success, workspace_id, created_at
    FROM execution_traces
    WHERE task_id = ? AND workspace_id = ?
    ORDER BY created_at ASC
  `).all(taskIdNum, workspaceId) as ExecutionTrace[]

  const bookmarks = db.prepare(`
    SELECT id, task_id, trace_id, step_index, label, note, created_by, workspace_id, created_at
    FROM replay_bookmarks
    WHERE task_id = ? AND workspace_id = ?
    ORDER BY step_index ASC
  `).all(taskIdNum, workspaceId) as ReplayBookmark[]

  return NextResponse.json({ success: true, data: { steps, bookmarks } })
}
