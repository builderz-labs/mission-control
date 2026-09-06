import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { authorizedWorkerJob, trustedWorkerCost, workerUpdateSql, type WorkerUpdate } from '@/lib/fly-worker-protocol'

export const dynamic = 'force-dynamic'

function token(request: NextRequest) { return request.headers.get('x-mc-fly-job-token') || '' }
function validUpdate(value: unknown): value is WorkerUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  return (data.state === undefined || ['running', 'succeeded', 'failed'].includes(String(data.state)))
    && ['cpu_percent', 'memory_bytes', 'swap_bytes', 'observed_cost_usd'].every(key => data[key] === undefined || (typeof data[key] === 'number' && Number.isFinite(data[key]) && data[key] >= 0))
    && (data.resolution === undefined || (typeof data.resolution === 'string' && data.resolution.length <= 10000))
    && (data.error_message === undefined || (typeof data.error_message === 'string' && data.error_message.length <= 5000))
    && (data.branch_name === undefined || (typeof data.branch_name === 'string' && /^mc\/fly-task-\d+-[a-z0-9]{8}$/.test(data.branch_name)))
}

async function jobFor(request: NextRequest, params: Promise<{ id: string }>) {
  const { id } = await params
  const job = authorizedWorkerJob(getDatabase(), id, token(request))
  return job ? { job } : { response: NextResponse.json({ error: 'Worker authorization failed' }, { status: 401 }) }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await jobFor(request, params)
  if ('response' in result) return result.response
  const task = getDatabase().prepare('SELECT id, title, description FROM tasks WHERE id = ? AND workspace_id = ?')
    .get(result.job.task_id, result.job.workspace_id) as Record<string, unknown> | undefined
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  return NextResponse.json({ job: { id: result.job.id, branch_name: result.job.branch_name, expires_at: result.job.expires_at }, task })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await jobFor(request, params)
  if ('response' in result) return result.response
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > 16_384) return NextResponse.json({ error: 'Worker update is too large' }, { status: 413 })
  const body: unknown = await request.json().catch(() => null)
  if (!validUpdate(body)) return NextResponse.json({ error: 'Invalid worker update' }, { status: 400 })
  const db = getDatabase(); const update = { ...(body as WorkerUpdate), observed_cost_usd: trustedWorkerCost(result.job) }
  const query = workerUpdateSql(result.job, update)
  const write = db.prepare(query.sql).run(...query.params)
  if (write.changes > 0 && (update.state === 'succeeded' || update.state === 'failed')) {
    const taskState = update.state === 'succeeded' ? 'review' : 'assigned'
    db.prepare("UPDATE tasks SET status = ?, resolution = COALESCE(?, resolution), error_message = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND status = 'in_progress'")
      .run(taskState, update.resolution ?? null, update.error_message ?? null, query.now, result.job.task_id, result.job.workspace_id)
    db_helpers.logActivity('fly_worker_completed', 'task', result.job.task_id as number, 'fly-worker', `Fly worker ${update.state}`, { job_id: result.job.id }, result.job.workspace_id as number)
    eventBus.broadcast('task.status_changed', { id: result.job.task_id, status: taskState, workspace_id: result.job.workspace_id })
  }
  eventBus.broadcast('fly.worker.updated', { workspace_id: result.job.workspace_id, job_id: result.job.id, state: update.state || result.job.state })
  return NextResponse.json({ ok: true, now: query.now })
}
