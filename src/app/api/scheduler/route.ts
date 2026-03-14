import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getSchedulerStatus, triggerTask } from '@/lib/scheduler'

/**
 * GET /api/scheduler - Get scheduler status
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({ tasks: getSchedulerStatus() })
}

/**
 * POST /api/scheduler - Manually trigger a scheduled task
 * Body: { task_id: 'auto_backup' | 'auto_cleanup' | 'agent_heartbeat' }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const taskId = typeof body?.task_id === 'string' ? body.task_id : ''
  const allowedTaskIds = new Set(getSchedulerStatus().map((task) => task.id))

  if (!taskId || !allowedTaskIds.has(taskId)) {
    return NextResponse.json({
      error: `task_id required: ${Array.from(allowedTaskIds).join(', ')}`,
    }, { status: 400 })
  }

  const result = await triggerTask(taskId)
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
