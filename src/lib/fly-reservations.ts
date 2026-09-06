import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { flyNumber, type FlySubmission } from './fly-admission-schema'
import type { SubmissionRow } from './fly-admission'
import { recommendFlyWorkerSize, type FlyUsageSample } from './fly-workers'
import { isFlyWorkerImageRef } from './fly-orchestrator'

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
    const max = Math.min(30, Math.floor(flyNumber('MC_FLY_MAX_WORKERS', 6)))
    if (count.n >= max) return null
    const browser = input.setup.endsWith('-playwright')
    const samples = db.prepare(`SELECT j.cpu_percent, j.memory_bytes, j.runtime_seconds, j.observed_cost_usd
      FROM fly_worker_jobs j JOIN fly_submissions s ON s.id=j.submission_id
      WHERE j.state='succeeded' AND j.repository=? AND json_extract(s.payload,'$.setup')=?
        AND json_extract(s.payload,'$.runtime')=? ORDER BY j.completed_at DESC LIMIT 50`)
      .all(input.repository, input.setup, input.runtime) as Array<{ cpu_percent: number; memory_bytes: number; runtime_seconds: number; observed_cost_usd: number }>
    const history: FlyUsageSample[] = samples.map(s => ({ cpuPercent: s.cpu_percent, memoryMb: s.memory_bytes / 1048576, runtimeSeconds: s.runtime_seconds, costUsd: s.observed_cost_usd }))
    const spec = recommendFlyWorkerSize({ requiresBrowser: browser, requiresTesting: input.checks.some(c => c !== 'smoke') }, history)
    const rate = flyNumber(`MC_FLY_${spec.size.replaceAll('-', '_').toUpperCase()}_HOURLY_USD`)
    const image = browser ? process.env.MC_FLY_BROWSER_IMAGE : process.env.MC_FLY_CORE_IMAGE
    const ttl = input.timeout_seconds + 300 // boot, result drain and cleanup margin
    const reserve = rate * ttl / 3600
    const now = Math.floor(Date.now() / 1000)
    const day = Math.floor(now / 86400) * 86400
    const month = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) / 1000)
    const spend = (since: number) => (db.prepare(`SELECT COALESCE(SUM(CASE WHEN state IN ('creating','running','cleaning')
      THEN MAX(estimated_cost_usd,observed_cost_usd) ELSE observed_cost_usd END),0) AS n
      FROM fly_worker_jobs WHERE created_at>=? OR state IN ('creating','running','cleaning')`).get(since) as { n: number }).n
    let reason = ''
    if (!rate || !isFlyWorkerImageRef(image)) reason = 'Pinned image or compute price missing'
    else if (reserve > flyNumber('MC_FLY_PER_JOB_BUDGET_USD')) reason = 'Per-job compute budget exceeded'
    else if (spend(day) + reserve > flyNumber('MC_FLY_DAILY_BUDGET_USD') || spend(month) + reserve > flyNumber('MC_FLY_MONTHLY_BUDGET_USD')) reason = 'Global compute budget reserved or exhausted'
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
      env: { ...(process.env.MC_FLY_GIT_AUTH_TOKEN ? { MC_FLY_GIT_AUTH_TOKEN: process.env.MC_FLY_GIT_AUTH_TOKEN } : {}) },
      metadata: { mission_control_job: id, mission_control_submission: row.id, worker_class: spec.workerClass },
    } }
  }).immediate()
}
