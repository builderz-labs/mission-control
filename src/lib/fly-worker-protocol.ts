import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'

export type WorkerUpdate = {
  state?: 'running' | 'succeeded' | 'failed'
  cpu_percent?: number
  memory_bytes?: number
  swap_bytes?: number
  observed_cost_usd?: number
  resolution?: string
  error_message?: string
  branch_name?: string
}

export type AuthorizedWorkerJob = Record<string, unknown> & {
  id: string
  task_id: number
  workspace_id: number
  state: string
  token_hash: string
  expires_at: number
}

export function createWorkerToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashWorkerToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function configuredRate(job: Record<string, unknown>): number {
  const size = typeof job.image_kind === 'string' ? job.image_kind : ''
  const key = `MC_FLY_${size.replaceAll('-', '_').toUpperCase()}_HOURLY_USD`
  const rate = Number(process.env[key])
  return Number.isFinite(rate) && rate > 0 ? rate : 0
}

/** Cost is derived by the control plane; worker claims are diagnostic only. */
export function trustedWorkerCost(job: Record<string, unknown>, now = Math.floor(Date.now() / 1000)): number {
  const startedAt = typeof job.started_at === 'number' ? job.started_at : now
  const cost = Math.max(0, now - startedAt) * configuredRate(job) / 3600
  return Math.round(cost * 1_000_000) / 1_000_000
}

export function authorizedWorkerJob(db: Database.Database, jobId: string, token: string): AuthorizedWorkerJob | null {
  if (!/^[a-zA-Z0-9_-]{12,96}$/.test(jobId) || token.length < 32 || token.length > 256) return null
  const job = db.prepare(`SELECT * FROM fly_worker_jobs WHERE id = ? LIMIT 1`).get(jobId) as Record<string, unknown> | undefined
  if (!job || !['creating', 'running'].includes(String(job.state)) || typeof job.token_hash !== 'string' || typeof job.expires_at !== 'number' || job.expires_at < Math.floor(Date.now() / 1000)) return null
  const expected = Buffer.from(job.token_hash)
  const received = Buffer.from(hashWorkerToken(token))
  return expected.length === received.length && timingSafeEqual(expected, received) ? job as AuthorizedWorkerJob : null
}

export function workerUpdateSql(job: Record<string, unknown>, update: WorkerUpdate) {
  const now = Math.floor(Date.now() / 1000)
  const startedAt = typeof job.started_at === 'number' ? job.started_at : now
  const fields = ['heartbeat_at = ?', 'runtime_seconds = ?']
  const params: Array<string | number | null> = [now, Math.max(0, now - startedAt)]
  if (update.cpu_percent !== undefined) { fields.push('cpu_percent = ?'); params.push(update.cpu_percent) }
  if (update.memory_bytes !== undefined) { fields.push('memory_bytes = ?'); params.push(update.memory_bytes) }
  if (update.swap_bytes !== undefined) { fields.push('swap_bytes = ?'); params.push(update.swap_bytes) }
  if (update.observed_cost_usd !== undefined) { fields.push('observed_cost_usd = ?'); params.push(update.observed_cost_usd) }
  if (update.branch_name) { fields.push('branch_name = ?'); params.push(update.branch_name) }
  if (update.state) {
    fields.push('state = ?'); params.push(update.state)
    if (update.state === 'running') { fields.push('started_at = COALESCE(started_at, ?)'); params.push(now) }
    if (update.state === 'succeeded' || update.state === 'failed') { fields.push('completed_at = ?'); params.push(now) }
  }
  if (update.error_message !== undefined) { fields.push('error_message = ?'); params.push(update.error_message.slice(0, 5000)) }
  return { sql: `UPDATE fly_worker_jobs SET ${fields.join(', ')} WHERE id = ? AND state IN ('creating', 'running')`, params: [...params, job.id as string], now }
}

