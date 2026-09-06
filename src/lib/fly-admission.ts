import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { eventBus } from './event-bus'
import { flyReadiness, type FlySubmission } from './fly-admission-schema'

export type SubmissionRow = {
  id: string; task_id: number; workspace_id: number; state: string; payload: string;
  payload_hash: string; request_key: string; attempts: number; reason: string | null;
}

export function submitFlyLeaf(db: Database.Database, input: FlySubmission, workspace: number, actor: string) {
  const payload = JSON.stringify({ ...input, request_id: undefined })
  const hash = createHash('sha256').update(payload).digest('hex')
  const requestKey = input.request_id || hash
  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM fly_submissions WHERE workspace_id=? AND request_key=?')
      .get(workspace, requestKey) as SubmissionRow | undefined
    if (existing) {
      if (existing.payload_hash !== hash) return { route: 'rejected', accepted: false, safe_local_fallback: false, reason: 'Request ID belongs to a different payload' }
      return { route: 'fly', accepted: true, safe_local_fallback: false, submission_id: existing.id, task_id: existing.task_id, state: existing.state }
    }
    const issues = flyReadiness(input)
    if (issues.length) return { route: 'local', accepted: false, safe_local_fallback: true, reason: issues.join('; ') }
    const depth = db.prepare("SELECT COUNT(*) AS n FROM fly_submissions WHERE state IN ('queued','running')").get() as { n: number }
    if (depth.n >= 1000) return { route: 'local', accepted: false, safe_local_fallback: true, reason: 'Admission queue is full' }
    const id = randomUUID().replaceAll('-', '')
    const task = db.prepare(`INSERT INTO tasks (title, description, status, priority, created_by, workspace_id, metadata)
      VALUES (?, ?, 'in_progress', ?, ?, ?, ?)`).run(input.title, input.description, input.priority, actor, workspace,
      JSON.stringify({ fly_submission_id: id, execution_target: 'fly', independent_review_required: true }))
    db.prepare(`INSERT INTO fly_submissions (id, workspace_id, request_key, payload_hash, payload, task_id, session_id, swarm_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, workspace, requestKey, hash, payload, task.lastInsertRowid, input.session_id || null, input.swarm_id || null, actor)
    eventBus.broadcast('fly.worker.updated', { workspace_id: workspace, submission_id: id, state: 'queued' })
    return { route: 'fly', accepted: true, safe_local_fallback: false, submission_id: id, task_id: Number(task.lastInsertRowid), state: 'queued' }
  }).immediate()
}

export function flySubmissionStatus(db: Database.Database, workspace: number, id?: string) {
  const rows = db.prepare(`SELECT id, task_id, state, reason, attempts, session_id, swarm_id, created_at, updated_at
    FROM fly_submissions WHERE workspace_id=? ${id ? 'AND id=?' : ''} ORDER BY created_at DESC LIMIT 100`)
    .all(...(id ? [workspace, id] : [workspace])) as Array<{ id: string }>
  return rows.map(row => ({ ...row, jobs: db.prepare(`SELECT id, machine_id, state, image_kind, branch_name, outcome_json,
    estimated_cost_usd, observed_cost_usd, runtime_seconds, cpu_percent, memory_bytes, swap_bytes,
    created_at, completed_at, cleanup_completed_at, error_message FROM fly_worker_jobs
    WHERE submission_id=? AND workspace_id=? ORDER BY created_at`).all(row.id, workspace) }))
}
