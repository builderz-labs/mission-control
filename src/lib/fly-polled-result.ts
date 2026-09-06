import type Database from 'better-sqlite3'
import { z } from 'zod'
import { eventBus } from './event-bus'
import type { ReservedJob } from './fly-reservations'

export const polledResultSchema = z.object({
  job_id: z.string(), state: z.enum(['running','succeeded','failed']),
  cpu_percent: z.number().min(0).max(10000).optional(),
  memory_bytes: z.number().min(0).max(1e12).optional(), swap_bytes: z.number().min(0).max(1e12).optional(),
  updated_at: z.number().int(), resolution: z.string().max(10000).optional(),
  error_message: z.string().max(5000).optional(), branch_name: z.string().optional(),
  result_sha: z.string().regex(/^[a-f0-9]{40}$/).optional(),
})

export function readPolledResult(text: string, job: ReservedJob) {
  if (Buffer.byteLength(text) > 20000) throw new Error('Worker result exceeds limit')
  const result = polledResultSchema.parse(JSON.parse(text))
  if (result.job_id !== job.id || (result.branch_name && result.branch_name !== job.branch_name)) throw new Error('Worker result identity mismatch')
  return result
}

export function recordPolledResult(db: Database.Database, job: ReservedJob, text: string) {
  const result = readPolledResult(text, job)
  const now = Math.floor(Date.now() / 1000)
  const runtime = Math.max(0, now - (job.started_at || job.created_at))
  const cost = runtime * job.hourly_rate_usd / 3600
  db.prepare(`UPDATE fly_worker_jobs SET state=?,heartbeat_at=?,runtime_seconds=?,observed_cost_usd=?,
    cpu_percent=MAX(COALESCE(cpu_percent,0),?),memory_bytes=MAX(COALESCE(memory_bytes,0),?),swap_bytes=?,outcome_json=?
    WHERE id=? AND state IN ('creating','running')`).run(result.state === 'running' ? 'running' : 'cleaning',now,runtime,cost,
      result.cpu_percent || 0,result.memory_bytes || 0,result.swap_bytes || 0,JSON.stringify(result),job.id)
  eventBus.broadcast('fly.worker.updated', { workspace_id: job.workspace_id, job_id: job.id, state: result.state })
  return result
}

/** Release ownership only after the Machine is confirmed absent. */
export function settleFlyJob(db: Database.Database, job: ReservedJob, fallbackReason = 'Worker disappeared before result delivery') {
  const now = Math.floor(Date.now() / 1000)
  db.transaction(() => {
    const current = db.prepare("SELECT * FROM fly_worker_jobs WHERE id=? AND state IN ('creating','running','cleaning')").get(job.id) as ReservedJob | undefined
    if (!current) return
    const outcome = current.outcome_json ? readPolledResult(current.outcome_json, current) : null
    const state = outcome?.state === 'succeeded' ? 'succeeded' : 'failed'
    const runtime = Math.max(0, now - (current.started_at || current.created_at))
    db.prepare('UPDATE fly_worker_jobs SET state=?,completed_at=?,cleanup_completed_at=?,runtime_seconds=?,observed_cost_usd=?,error_message=? WHERE id=?')
      .run(state,now,now,runtime,Math.max(current.observed_cost_usd,runtime*current.hourly_rate_usd/3600),state === 'failed' ? outcome?.error_message || fallbackReason : null,job.id)
    const submission = db.prepare('SELECT attempts FROM fly_submissions WHERE id=?').get(job.submission_id) as { attempts: number }
    const retry = state === 'failed' && !outcome && submission.attempts < 2
    db.prepare('UPDATE fly_submissions SET state=?,reason=?,next_attempt_at=?,updated_at=? WHERE id=?')
      .run(retry ? 'queued' : state, state === 'failed' ? outcome?.error_message || fallbackReason : null,now+30,now,job.submission_id)
    db.prepare('UPDATE tasks SET status=?,resolution=?,error_message=?,updated_at=? WHERE id=? AND workspace_id=?')
      .run(retry ? 'in_progress' : state === 'succeeded' ? 'review' : 'inbox', outcome?.resolution || null,
        state === 'failed' ? outcome?.error_message || fallbackReason : null,now,job.task_id,job.workspace_id)
  }).immediate()
  eventBus.broadcast('fly.worker.updated', { workspace_id: job.workspace_id, job_id: job.id, state: 'settled' })
}
