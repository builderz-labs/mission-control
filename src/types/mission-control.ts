export type MissionControlStage = 'scan' | 'plan' | 'patch' | 'validate' | 'report' | 'idle'

export type UnifiedStatusEventSource = 'session' | 'task' | 'log' | 'gateway' | 'local'

export type UnifiedStatusEventKind =
  | 'agent_start'
  | 'heartbeat'
  | 'status'
  | 'tool_call'
  | 'task_update'
  | 'stage_change'
  | 'review'
  | 'error'

export interface UnifiedStatusEvent {
  id: string
  ts: string
  agentId: string
  agentName: string
  source: UnifiedStatusEventSource
  kind: UnifiedStatusEventKind
  stage?: MissionControlStage
  taskId?: string
  taskTitle?: string
  summary: string
  toolName?: string
  toolTarget?: string
  toolResult?: string
  toolArgsPreview?: string
  progressPct?: number
  thinkingSummary?: string
  latency?: number
  model?: string
  tokenUsage?: number
  severity?: 'info' | 'warn' | 'error'
  blocker?: string
}

export interface MissionControlSummary {
  agentsRegistered: number
  agentsReachable: number
  agentsActive: number
  tasksRunning: number
  errors24h: number
  eventRate: number
}

export interface MissionControlTaskRow {
  id: number
  title: string
  status: string
  priority: string
  assignedTo: string | null
  stage: MissionControlStage
  updatedAt: string
  blocker?: string
  debatePending?: boolean
  debateReason?: string
  debateRounds?: number
  lastSelfHealAt?: string
  selfHealActions?: number
  orchestratorDecision?: string
  orchestratorReportType?: 'problem' | 'wait' | 'bug_restart'
  orchestratorReport?: string
}

export interface MissionControlAgentRow {
  agentId: string
  agentName: string
  stage: MissionControlStage
  task?: string
  tool?: string
  progressPct?: number
  lastEventTs?: string
  status: 'active' | 'idle' | 'offline'
  thinkingSummary?: string
  model?: string
  tokenUsage?: number
  latency?: number
  blocker?: string
  severity?: 'info' | 'warn' | 'error'
  summary?: string
  reachable: boolean
}

export interface MissionControlPipelineStage {
  key: Exclude<MissionControlStage, 'idle'>
  label: string
  status: 'completed' | 'running' | 'pending' | 'error'
}

export interface MissionControlHeartbeatRow {
  agentId: string
  agentName: string
  status: 'active' | 'idle' | 'offline'
  lastHeartbeatTs?: string
  memoryUsage?: string
  cpuUsage?: string
}

export interface MissionControlToolTimelineEntry {
  id: string
  ts: string
  agentName: string
  toolName: string
  target?: string
  result?: string
  latency?: number
}

export interface MissionControlUsageMetric {
  model: string
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  callsPerMinute: number
}

export interface MissionControlUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalEstimatedCost: number
  callsPerMinute: number
  models: MissionControlUsageMetric[]
}

export interface MissionControlBlockedWorkflow {
  id: string
  agentName: string
  reason: string
  taskTitle?: string
  stage?: MissionControlStage
}

export interface MissionControlPipelineInspectorStage {
  key: Exclude<MissionControlStage, 'idle'>
  label: string
  status: 'completed' | 'running' | 'pending' | 'error'
  startTime?: string
  durationMs?: number
  agentsInvolved: string[]
  logs: string[]
}

export interface OrchestratorControlState {
  state: 'running' | 'paused' | 'stopped' | 'idle'
  dispatchEnabled: boolean
  scheduledRunsEnabled: boolean
  fallbackEnabled: boolean
  autonomousLoopEnabled?: boolean
  autoSpawnEnabled?: boolean
  debateEnabled?: boolean
  selfHealEnabled?: boolean
  schedulerRunning: boolean
  activeRuns: number
  autoSpawnedAgents?: number
  debatePendingTasks?: number
  lastResult?: string
}

export interface MissionControlSnapshot {
  generatedAt: string
  summary: MissionControlSummary
  agents: MissionControlAgentRow[]
  tasks: MissionControlTaskRow[]
  events: UnifiedStatusEvent[]
  pipeline: MissionControlPipelineStage[]
  heartbeat: MissionControlHeartbeatRow[]
  toolTimeline: MissionControlToolTimelineEntry[]
  usage: MissionControlUsageSummary
  blocked: MissionControlBlockedWorkflow[]
  pipelineInspector: MissionControlPipelineInspectorStage[]
  orchestrator: OrchestratorControlState
}

export interface OrchestratorControlActionResponse {
  ok: boolean
  action: 'wake' | 'start' | 'pause' | 'stop' | 'restart'
  message: string
  orchestrator: OrchestratorControlState
}
