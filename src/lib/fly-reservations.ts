import { flyWorkerLimit } from './fly-capacity'
import { flyRepositoryAuth } from './fly-repository-auth'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { flyNumber, type FlySubmission } from './fly-admission-schema'
import type { SubmissionRow } from './fly-admission'
import { priceFromFlyHistory } from './fly-sizing-history'
import { flyBudgetPeriods, flyCommittedSpend } from './fly-budget'

export type ReservedJob = {
  id: string; task_id: number; workspace_id: number; submission_id: string; state: string;
  machine_id: string | null; launch_name: string; branch_name: string; expires_at: number;
  created_at: number; started_at: number | null; hourly_rate_usd: number; image_kind: string;
  outcome_json: string | null; transport: string; observed_cost_usd: number;
}

export function reserveFlyJob(db: Database.Database, row: SubmissionRow, input: FlySubmission) {
  return db.transaction(() => {
    const fresh = db.prepare("SELECT * FROM fly_submissions WHERE id=? AND state='queued' AND next_attempt_at<=unixepoch()")
      .get(row.id) as SubmissionRow | undefined
    if (!fresh) return null
    const count = db.prepare("SELECT COUNT(*) AS n FROM fly_worker_jobs WHERE state IN ('creating','running','cleaning')").get() as { n: number }
    const max = flyWorkerLimit()
    if (count.n >= max) return null
    const { spec, rate, image, ttl, reserve, issues } = priceFromFlyHistory(db,input)
    const now = Math.floor(Date.now() / 1000)
    const { day, month } = flyBudgetPeriods()
    let reason = issues.join('; ')
    const previous = (db.prepare('SELECT COALESCE(SUM(observed_cost_usd),0) AS spent FROM fly_worker_jobs WHERE submission_id=?')
      .get(row.id) as {spent:number}).spent
    if (!reason && previous + reserve > flyNumber('MC_FLY_PER_JOB_BUDGET_USD')) reason = 'Cumulative per-job compute budget exhausted'
    if (!reason && (flyCommittedSpend(db,day) + reserve > flyNumber('MC_FLY_DAILY_BUDGET_USD') || flyCommittedSpend(db,month) + reserve > flyNumber('MC_FLY_MONTHLY_BUDGET_USD'))) reason = 'Global compute budget reserved or exhausted'
    if (reason) {
      db.prepare('UPDATE fly_submissions SET reason=?,next_attempt_at=? WHERE id=?').run(reason, now + 60, row.id)
      return null
    }
    const id = randomUUID().replaceAll('-', '')
    const branch = `mc/fly-task-${row.task_id}-${id.slice(0, 8)}`
    const name = `mc-${id}`
    db.prepare(`INSERT INTO fly_worker_jobs (id,task_id,workspace_id,state,worker_class,execution_target,image_kind,
      branch_name,repository,token_hash,estimated_cost_usd,expires_at,submission_id,hourly_rate_usd,launch_name,transport)
      VALUES (?,?,?,'creating',?,'fly',?,?,?,?,?,?,?,?,?,'poll')`)
      .run(id,row.task_id,row.workspace_id,spec.workerClass,spec.size,branch,input.repository,'',reserve,now+ttl,row.id,rate,name)
    db.prepare("UPDATE fly_submissions SET state='running',attempts=attempts+1,reason=NULL,updated_at=? WHERE id=?").run(now,row.id)
    const payload = { ...input, id, branch_name: branch, expires_at: now + ttl }
    return { id, name, config: { image, auto_destroy: true, restart: { policy: 'no' },
      guest: { cpu_kind: spec.cpuKind, cpus: spec.cpus, memory_mb: spec.memoryMb },
      files: [{ guest_path: '/etc/mc-job.json', raw_value: Buffer.from(JSON.stringify(payload)).toString('base64') }],
      env: { MC_FLY_WORKER_CLASS: spec.workerClass, ...flyRepositoryAuth(input.repository) },
      metadata: { mission_control_job: id, mission_control_submission: row.id, worker_class: spec.workerClass },
    } }
  }).immediate()
}
