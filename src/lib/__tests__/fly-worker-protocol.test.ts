import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { buildFlyTelemetry } from '@/lib/fly-telemetry'
import { authorizedWorkerJob, hashWorkerToken, trustedWorkerCost, workerUpdateSql } from '@/lib/fly-worker-protocol'

function dbWithJobs() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE fly_worker_jobs (id TEXT, task_id INTEGER, workspace_id INTEGER, state TEXT, worker_class TEXT, execution_target TEXT, observed_cost_usd REAL, estimated_cost_usd REAL, runtime_seconds INTEGER, cpu_percent REAL, memory_bytes INTEGER, swap_bytes INTEGER, heartbeat_at INTEGER, created_at INTEGER, started_at INTEGER, branch_name TEXT, token_hash TEXT, expires_at INTEGER, completed_at INTEGER, error_message TEXT)`)
  return db
}

describe('Fly worker protocol', () => {
  it('authorizes only the job-scoped token with a constant-time hash comparison', () => {
    const db = dbWithJobs(); const token = 'a'.repeat(43)
    db.prepare('INSERT INTO fly_worker_jobs (id, task_id, workspace_id, state, worker_class, execution_target, token_hash, created_at, expires_at) VALUES (?, 1, 1, ?, ?, ?, ?, ?, ?)').run('job_1234567890', 'running', 'core', 'fly', hashWorkerToken(token), 1, Math.floor(Date.now() / 1000) + 60)
    expect(authorizedWorkerJob(db, 'job_1234567890', token)?.id).toBe('job_1234567890')
    expect(authorizedWorkerJob(db, 'job_1234567890', 'b'.repeat(43))).toBeNull()
    db.prepare('UPDATE fly_worker_jobs SET expires_at = ? WHERE id = ?').run(1, 'job_1234567890')
    expect(authorizedWorkerJob(db, 'job_1234567890', token)).toBeNull()
  })

  it('records bounded worker heartbeats and completion transitions', () => {
    const db = dbWithJobs(); const job = { id: 'job_1234567890', started_at: 1 }
    const update = workerUpdateSql(job, { state: 'succeeded', cpu_percent: 80, resolution: 'done' })
    expect(update.sql).toContain('completed_at = ?')
    expect(update.sql).toContain("state IN ('creating', 'running')")
    expect(update.params).toContain('succeeded')
  })

  it('derives observed cost from control-plane timing rather than worker input', () => {
    const original = process.env.MC_FLY_CORE_SMALL_HOURLY_USD
    process.env.MC_FLY_CORE_SMALL_HOURLY_USD = '0.12'
    expect(trustedWorkerCost({ image_kind: 'core-small', started_at: 100 }, 1900)).toBe(0.06)
    if (original === undefined) delete process.env.MC_FLY_CORE_SMALL_HOURLY_USD
    else process.env.MC_FLY_CORE_SMALL_HOURLY_USD = original
  })

  it('builds a queue, fleet, cost, and Mac telemetry snapshot', () => {
    const db = dbWithJobs(); const now = Math.floor(Date.now() / 1000)
    db.prepare('INSERT INTO fly_worker_jobs (id, task_id, workspace_id, state, worker_class, execution_target, observed_cost_usd, estimated_cost_usd, cpu_percent, memory_bytes, created_at) VALUES (?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?)').run('job1', 'running', 'browser', 'fly', 0.1, 0.3, 75, 1024, now)
    const snapshot = buildFlyTelemetry(db, 1)
    expect(snapshot.fleet.running).toBe(1)
    expect(snapshot.cost.daily_spend).toBe(0.1)
    expect(snapshot.mac.memory_percent).toBeGreaterThanOrEqual(0)
  })
})
