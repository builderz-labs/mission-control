export interface WorkflowTemplate {
  id: number
  name: string
  model: string
}

export interface PipelineStep {
  template_id: number
  template_name?: string
  on_failure: 'stop' | 'continue'
}

export interface Pipeline {
  id: number
  name: string
  description: string | null
  steps: PipelineStep[]
  use_count: number
  last_used_at: number | null
  runs: { total: number; completed: number; failed: number; running: number }
}

export interface RunStepState {
  step_index: number
  template_id: number
  template_name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  spawn_id: string | null
  started_at: number | null
  completed_at: number | null
  error: string | null
}

export interface PipelineRun {
  id: number
  pipeline_id: number
  pipeline_name?: string
  status: string
  current_step: number
  steps_snapshot: RunStepState[]
  started_at: number | null
  completed_at: number | null
  triggered_by: string
  created_at: number
}
