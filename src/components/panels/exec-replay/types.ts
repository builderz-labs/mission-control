// ─── API / domain types ───────────────────────────────────────────────────────

export interface TaskSummary {
  task_id: number
  session_id: string | null
  step_count: number
  started_at: number
  ended_at: number
}

export interface ExecutionTrace {
  id: number
  task_id: number | null
  session_id: string | null
  step_type: string
  step_data: string
  tokens_used: number | null
  duration_ms: number | null
  success: number
  workspace_id: number
  created_at: number
}

export interface ReplayBookmark {
  id: number
  task_id: number
  trace_id: number
  step_index: number
  label: string | null
  note: string | null
  created_by: string
  workspace_id: number
  created_at: number
}

export interface TraceData {
  steps: ExecutionTrace[]
  bookmarks: ReplayBookmark[]
}
