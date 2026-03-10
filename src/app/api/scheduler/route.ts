import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getSchedulerStatus, triggerTask } from '@/lib/scheduler'
import { ensureSchedulerStarted } from '@/lib/runtime-services'

/**
 * GET /api/scheduler - Get scheduler status
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  ensureSchedulerStarted()

  return NextResponse.json({ tasks: getSchedulerStatus() })
}

/**
 * POST /api/scheduler - Manually trigger a scheduled task
 * Body: { task_id: 'auto_backup' | 'auto_cleanup' | 'agent_heartbeat' }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  ensureSchedulerStarted()

  const body = await request.json().catch(() => ({}))
  const taskId = body.task_id

  const validTasks = ['auto_backup', 'auto_cleanup', 'agent_heartbeat', 'webhook_retry', 'claude_session_scan', 'orchestrator_dispatch', 'auto_progress', 'scheduled_agent_runs', 'groq_fallback']
  if (!taskId || !validTasks.includes(taskId)) {
    return NextResponse.json({ error: `task_id required: ${validTasks.join(', ')}` }, { status: 400 })
  }

  const result = await triggerTask(taskId)
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
