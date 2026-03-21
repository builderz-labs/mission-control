import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { parseNaturalSchedule } from '@/lib/schedule-parser'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'

/**
 * POST /api/jarvis/schedule
 *
 * Wires a plain-English schedule expression to Mission Control's recurring
 * task system. Takes an existing task ID and a natural-language schedule
 * string, parses the schedule via the existing parseNaturalSchedule function,
 * and writes the recurrence metadata back to that task's metadata column.
 *
 * This does NOT create a new task — the task must already exist. The task
 * becomes a template: the scheduler will clone it on each cron tick.
 *
 * Request body:
 * {
 *   task_id: number,          // existing MC task to make recurring
 *   schedule: string,         // natural language, e.g. "every morning at 9am"
 *   enabled?: boolean         // default true
 * }
 *
 * Response (success):
 * {
 *   ok: true,
 *   task_id: number,
 *   cron_expr: string,
 *   human_readable: string
 * }
 *
 * Response (parse failure):
 * {
 *   ok: false,
 *   error: "Could not parse schedule expression",
 *   hint: "Try: 'every morning at 9am', 'every Monday at 2pm', 'every 4 hours'"
 * }
 *
 * You can also GET /api/jarvis/schedule?task_id=N to read current recurrence
 * settings without modifying them.
 *
 * Note: to disable recurrence, POST with enabled: false.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: { task_id: unknown; schedule: unknown; enabled?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const taskId = typeof body.task_id === 'number' ? body.task_id : parseInt(String(body.task_id ?? ''), 10)
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: 'task_id must be a positive integer' }, { status: 400 })
  }

  const scheduleInput = typeof body.schedule === 'string' ? body.schedule.trim() : ''
  if (!scheduleInput) {
    return NextResponse.json({ error: 'schedule is required' }, { status: 400 })
  }

  // Parse via existing MC parser — do not rebuild
  const parsed = parseNaturalSchedule(scheduleInput)
  if (!parsed) {
    return NextResponse.json({
      ok: false,
      error: 'Could not parse schedule expression',
      hint: "Try: 'every morning at 9am', 'every Monday at 2pm', 'every 4 hours', 'daily', 'hourly'",
    }, { status: 400 })
  }

  const enabled = body.enabled !== false // default true

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  const task = db.prepare(
    'SELECT id, metadata FROM tasks WHERE id = ? AND workspace_id = ?',
  ).get(taskId, workspaceId) as { id: number; metadata: string | null } | undefined

  if (!task) {
    return NextResponse.json({ error: `Task ${taskId} not found in this workspace` }, { status: 404 })
  }

  let existingMeta: Record<string, unknown>
  try {
    existingMeta = task.metadata ? JSON.parse(task.metadata) : {}
  } catch {
    existingMeta = {}
  }

  const nowSec = Math.floor(Date.now() / 1000)

  const recurrence = {
    cron_expr: parsed.cronExpr,
    natural_text: parsed.humanReadable,
    enabled,
    last_spawned_at: null,
    spawn_count: (existingMeta.recurrence as any)?.spawn_count ?? 0,
    parent_task_id: null, // marks this as a template, not a spawned child
  }

  const updatedMeta = { ...existingMeta, recurrence }

  db.prepare(
    'UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
  ).run(JSON.stringify(updatedMeta), nowSec, taskId, workspaceId)

  logger.info(
    { taskId, cron: parsed.cronExpr, human: parsed.humanReadable, enabled },
    'Recurring schedule set via JARVIS integration',
  )

  return NextResponse.json({
    ok: true,
    task_id: taskId,
    cron_expr: parsed.cronExpr,
    human_readable: parsed.humanReadable,
    enabled,
  })
}

/**
 * GET /api/jarvis/schedule?task_id=N
 *
 * Returns the current recurrence settings for a task without modifying them.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const taskIdRaw = request.nextUrl.searchParams.get('task_id')
  const taskId = parseInt(taskIdRaw ?? '', 10)
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: 'task_id query param is required' }, { status: 400 })
  }

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  const task = db.prepare(
    'SELECT id, metadata FROM tasks WHERE id = ? AND workspace_id = ?',
  ).get(taskId, workspaceId) as { id: number; metadata: string | null } | undefined

  if (!task) {
    return NextResponse.json({ error: `Task ${taskId} not found` }, { status: 404 })
  }

  let meta: Record<string, unknown> = {}
  try {
    meta = task.metadata ? JSON.parse(task.metadata) : {}
  } catch {
    // leave empty
  }

  const recurrence = (meta.recurrence as Record<string, unknown> | undefined) ?? null

  return NextResponse.json({ task_id: taskId, recurrence })
}
