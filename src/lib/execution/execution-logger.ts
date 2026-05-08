/**
 * Execution Event Logger
 *
 * Append-only log of structured execution events for the live execution path.
 * Stored in the execution_events DB table.
 *
 * All writes are best-effort: failures are swallowed so a logging error
 * never disrupts the execution path.
 */

import { getDatabase } from '@/lib/db'

export type ExecutionEventType =
  | 'spawn_started'
  | 'spawn_completed'
  | 'spawn_failed'
  | 'gate_denied'
  | 'execution_failure'
  | 'dispatch_started'
  | 'dispatch_completed'
  | 'dispatch_failed'
  | 'run_interrupted'
  | 'run_recovered'

export interface ExecutionEvent {
  event_type: ExecutionEventType
  provider_id?: string
  task_id?: number | null
  workspace_id: number
  session_key?: string | null
  duration_ms?: number | null
  success?: boolean
  error_code?: string | null
  detail?: Record<string, unknown> | null
  run_id?: number | null
}

export function logExecutionEvent(event: ExecutionEvent): void {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`
      INSERT INTO execution_events
        (event_type, provider_id, task_id, workspace_id, session_key,
         duration_ms, success, error_code, detail, run_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.event_type,
      event.provider_id ?? null,
      event.task_id ?? null,
      event.workspace_id,
      event.session_key ?? null,
      event.duration_ms ?? null,
      event.success !== false ? 1 : 0,
      event.error_code ?? null,
      event.detail ? JSON.stringify(event.detail) : null,
      event.run_id ?? null,
      now,
    )
  } catch {
    // non-fatal — never interrupt execution for a logging failure
  }
}
