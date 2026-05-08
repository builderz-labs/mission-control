/**
 * Execution Replay Types
 *
 * Immutable record types for the execution replay foundation.
 * execution_runs tracks a single execution attempt end-to-end.
 * execution_run_steps records each discrete step within a run, ordered
 * by a monotonically increasing sequence number.
 */

export type RunStatus = 'running' | 'completed' | 'failed' | 'interrupted'

export type StepType = 'provider_call' | 'failure'

export interface ExecutionRun {
  id: number
  run_key: string
  task_id: number | null
  workspace_id: number
  provider_id: string | null
  agent_name: string | null
  status: RunStatus
  started_at: number
  completed_at: number | null
  error_code: string | null
  error_message: string | null
  step_count: number
  event_sequence: number
  detail: Record<string, unknown> | null
  created_at: number
}

export interface ExecutionRunStep {
  id: number
  run_id: number
  sequence: number
  step_type: StepType
  provider_id: string | null
  success: boolean
  duration_ms: number | null
  payload: Record<string, unknown> | null
  workspace_id: number
  created_at: number
}

export interface RunTimeline {
  run: ExecutionRun
  steps: ExecutionRunStep[]
}
