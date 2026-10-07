export type FactoryFreshnessState = 'fresh' | 'stale' | 'error'
export type FactoryCanonicalPhase =
  | 'intake'
  | 'research'
  | 'validate'
  | 'design'
  | 'build'
  | 'qa'
  | 'release'
  | 'operate'
  | 'learn'
  | 'closed'
  | 'unknown'

export type FactoryLifecycleStatus = 'ready' | 'running' | 'blocked' | 'failed' | 'completed' | 'unknown'

/** Executors a planned factory step may request. Claude Code is modeled for capability discovery only. */
export type InstructionExecutor = 'deterministic' | 'codex-medium' | 'codex-high' | 'claude-code'
export type InstructionArea = 'search' | 'marketing' | 'creative-video' | 'dev'
export type InstructionStepStatus = 'planned' | 'requires-human-approval' | 'executor-unavailable'

export interface InstructionPlanStep {
  id: string
  area: InstructionArea
  objective: string
  executor: InstructionExecutor
  executor_available: boolean
  status: InstructionStepStatus
  requires_human_approval: boolean
  approval_reason?: string
}

export interface InstructionPlan {
  goal: string
  steps: InstructionPlanStep[]
  requires_human_approval: boolean
  executor_availability: Record<InstructionExecutor, boolean>
  notes: string[]
}

/** Normalized shape for future factory execution results; this router does not execute steps. */
export interface FactoryExecutionResult {
  state: 'success' | 'failed' | 'blocked' | 'skipped'
  summary: string
  output?: unknown
  error?: string | null
  approval_required: boolean
  evidence_refs: string[]
}

export interface FactoryCommandDefinition {
  id: string
  mode: 'read_only' | 'mutating'
  risk: 'low' | 'medium' | 'high' | 'critical'
  description: string
  human_confirmation: 'never' | 'conditional' | 'always'
}

export interface FactoryGateDefinition {
  id: string
  stage_id: string | null
  decision_owner: 'human' | 'ai' | 'deterministic'
  blocking: boolean
  decisions: string[]
  apply_command?: string | null
}

export interface FactoryStageDefinition {
  id: string
  label: string
  objective: string
  human_gates: string[]
  next: string[]
}

export interface FactoryDefinition {
  contract_version: '1.0'
  module: {
    id: string
    name: string
    purpose: string
    definition_version: string
    state_authority: 'external' | 'tower'
    adapter_kind: string
  }
  capabilities: {
    discover_instances: boolean
    read_snapshot: boolean
    request_approval: boolean
    execute_commands: boolean
    read_metrics: boolean
    emit_experience: boolean
  }
  stages: FactoryStageDefinition[]
  gates: FactoryGateDefinition[]
  commands: FactoryCommandDefinition[]
  cost_policy: Record<string, unknown>
  learning_policy: Record<string, unknown>
}

export interface FactoryGateSnapshot {
  id: string
  state: 'approved' | 'open' | 'closed' | 'unavailable' | 'unknown'
  blocking: boolean
  decided_at?: string | null
  note?: string | null
  evidence_refs: string[]
}

export interface FactoryCheckSnapshot {
  id: string
  ok: boolean
  detail: string
}

export interface FactoryReviewQueueItem {
  kind: string
  status: string
  queued_at?: string | null
  last_error?: string | null
  symbolic_action?: string | null
}

export interface FactoryActionAvailability {
  command_id: string
  available: boolean
  reason?: string | null
  risk: 'low' | 'medium' | 'high' | 'critical'
}

export interface FactoryWorkItem {
  action_id: string
  target_id: string
  expected_native_state: string | null
  action_kind: string
  blocking: boolean
  label: string
}

export interface FactoryWorkContext {
  source_revision: string
  ordered_work_queue: FactoryWorkItem[]
  primary_work_item: FactoryWorkItem | null
}

export interface FactorySnapshot {
  snapshot_version: '1.0'
  instance_id: string
  module_id: string
  observed_at: string
  source: {
    authority: string
    native_id: string
    revision: string
    adapter_version: string
  }
  freshness: {
    state: FactoryFreshnessState
    last_success_at: string | null
    last_error: string | null
  }
  lifecycle: {
    process_stage_id: string | null
    native_stage: string | null
    canonical_phase: FactoryCanonicalPhase
    status: FactoryLifecycleStatus
  }
  compatibility: {
    native_version: string
    contract_coverage: 'full' | 'partial' | 'unknown'
    warnings: string[]
  }
  gates: FactoryGateSnapshot[]
  checks: FactoryCheckSnapshot[]
  artifacts: Array<Record<string, unknown>>
  review_queues: FactoryReviewQueueItem[]
  next_actions: Array<{ id: string; label: string; kind: string; blocking: boolean }>
  work_context?: FactoryWorkContext | null
  blockers: Array<{ id: string; label: string; detail?: string | null; source: string }>
  risks: Array<Record<string, unknown>>
  metrics: Array<Record<string, unknown>>
  available_commands: FactoryActionAvailability[]
  raw_summary?: Record<string, unknown>
}

export interface FactoryInstanceRecord {
  id: number
  workspace_id: number
  instance_id: string
  module_id: string
  adapter_id: string
  native_id: string
  root_path: string | null
  enabled: number
  config: string
  created_at: number
  updated_at: number
}

export interface FactoryApprovalRequest {
  id: number
  workspace_id: number
  request_id: string
  instance_id: string
  gate_id: string
  title: string
  description: string | null
  state: 'OPEN' | 'DECISION_RECORDED' | 'APPLYING' | 'APPLIED' | 'FAILED' | 'STALE' | 'HELD' | 'REVISION_REQUESTED'
  decision: string | null
  decision_note: string | null
  decision_by: string | null
  decision_at: number | null
  expected_revision: string | null
  evidence_refs: string
  native_result: string | null
  created_at: number
  updated_at: number
}
