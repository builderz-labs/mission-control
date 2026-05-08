/**
 * Execution Replay Loader
 *
 * Append-only DB access layer for execution_runs and execution_run_steps.
 * All writes are idempotent where possible (INSERT OR IGNORE for steps).
 * All reads return null / empty-array on error rather than throwing.
 */

import { getDatabase } from '@/lib/db'
import type { ExecutionRun, ExecutionRunStep, RunStatus, RunTimeline, StepType } from './replay-types'

function mapRun(row: Record<string, unknown>): ExecutionRun {
  return {
    ...(row as unknown as ExecutionRun),
    detail: row.detail ? JSON.parse(row.detail as string) : null,
  }
}

function mapStep(row: Record<string, unknown>): ExecutionRunStep {
  return {
    ...(row as unknown as ExecutionRunStep),
    success: Boolean(row.success),
    payload: row.payload ? JSON.parse(row.payload as string) : null,
  }
}

export function loadRunTimeline(runId: number): RunTimeline | null {
  try {
    const db = getDatabase()
    const run = db.prepare('SELECT * FROM execution_runs WHERE id = ?').get(runId) as Record<string, unknown> | undefined
    if (!run) return null
    const steps = db.prepare(
      'SELECT * FROM execution_run_steps WHERE run_id = ? ORDER BY sequence ASC'
    ).all(runId) as Record<string, unknown>[]
    return { run: mapRun(run), steps: steps.map(mapStep) }
  } catch {
    return null
  }
}

export function getExecutionStepSequence(runId: number): ExecutionRunStep[] {
  try {
    const db = getDatabase()
    const rows = db.prepare(
      'SELECT * FROM execution_run_steps WHERE run_id = ? ORDER BY sequence ASC'
    ).all(runId) as Record<string, unknown>[]
    return rows.map(mapStep)
  } catch {
    return []
  }
}

export interface CreateRunParams {
  run_key: string
  task_id?: number | null
  workspace_id: number
  provider_id?: string | null
  agent_name?: string | null
  detail?: Record<string, unknown> | null
}

export function createExecutionRun(params: CreateRunParams): number | null {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const result = db.prepare(`
      INSERT INTO execution_runs
        (run_key, task_id, workspace_id, provider_id, agent_name, status, started_at, detail, created_at)
      VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)
    `).run(
      params.run_key,
      params.task_id ?? null,
      params.workspace_id,
      params.provider_id ?? null,
      params.agent_name ?? null,
      now,
      params.detail ? JSON.stringify(params.detail) : null,
      now,
    )
    return Number(result.lastInsertRowid)
  } catch {
    return null
  }
}

export interface AppendStepParams {
  run_id: number
  sequence: number
  step_type: StepType
  provider_id?: string | null
  success: boolean
  duration_ms?: number | null
  payload?: Record<string, unknown> | null
  workspace_id: number
}

export function appendRunStep(params: AppendStepParams): number | null {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const result = db.prepare(`
      INSERT OR IGNORE INTO execution_run_steps
        (run_id, sequence, step_type, provider_id, success, duration_ms, payload, workspace_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.run_id,
      params.sequence,
      params.step_type,
      params.provider_id ?? null,
      params.success ? 1 : 0,
      params.duration_ms ?? null,
      params.payload ? JSON.stringify(params.payload) : null,
      params.workspace_id,
      now,
    )
    if (result.changes > 0) {
      db.prepare(`
        UPDATE execution_runs
        SET step_count = step_count + 1, event_sequence = ?
        WHERE id = ?
      `).run(params.sequence, params.run_id)
    }
    return Number(result.lastInsertRowid)
  } catch {
    return null
  }
}

export function updateRunStatus(
  runId: number,
  status: RunStatus,
  opts?: { error_code?: string; error_message?: string },
): void {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const isTerminal = status === 'completed' || status === 'failed' || status === 'interrupted'

    const sets: string[] = ['status = ?']
    const values: unknown[] = [status]

    if (isTerminal) { sets.push('completed_at = ?'); values.push(now) }
    if (opts?.error_code !== undefined) { sets.push('error_code = ?'); values.push(opts.error_code) }
    if (opts?.error_message !== undefined) { sets.push('error_message = ?'); values.push(opts.error_message) }

    values.push(runId)
    db.prepare(`UPDATE execution_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  } catch {
    // best-effort
  }
}

export function getIncompleteRuns(workspaceId: number, staleThresholdSec = 600): ExecutionRun[] {
  try {
    const db = getDatabase()
    const cutoff = Math.floor(Date.now() / 1000) - staleThresholdSec
    const rows = db.prepare(`
      SELECT * FROM execution_runs
      WHERE workspace_id = ? AND status = 'running' AND started_at < ?
      ORDER BY started_at ASC
    `).all(workspaceId, cutoff) as Record<string, unknown>[]
    return rows.map(mapRun)
  } catch {
    return []
  }
}
