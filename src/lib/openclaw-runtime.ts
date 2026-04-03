import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { type OpenClawDispatchClaim, type OpenClawExecutionSnapshotRow, type OpenClawTaskRow, db_helpers, logAuditEvent } from '@/lib/db'
import { getRun, updateRun, createRun, type AgentRun } from '@/lib/runs'
import { resolveTaskImplementationTarget } from '@/lib/task-routing'

export class OpenClawRuntimeError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'OpenClawRuntimeError'
    this.code = code
    this.status = status
  }
}

export interface OpenClawClaimRequest {
  dispatchId: number
  agentId: string
  runtimeNodeId: string
  runtimeSessionId: string
  capabilityTags: string[]
  workspaceId: number
  actor: string
  actorId?: number
  ipAddress?: string | null
  userAgent?: string | null
}

export interface OpenClawSnapshotRequest {
  dispatchId: number
  agentId: string
  runtimeSessionId: string
  workspaceId: number
}

export interface OpenClawExecutionSnapshot {
  dispatch_id: number
  task_id: number
  title: string
  description: string | null
  status: string
  priority: string
  assigned_to: string | null
  metadata: Record<string, unknown>
  implementation_repo?: string
  code_location?: string
}

export interface OpenClawClaimResult {
  dispatch_id: number
  task_id: number
  dispatch_status: 'acked'
  acked_at: number
  snapshot_hash: string
  run_id: string
}

export interface OpenClawHeartbeatRequest {
  agentId: string
  runtimeType?: string
  runtimeNodeId: string
  runtimeSessionId: string
  nodeStatus: 'online' | 'busy' | 'idle' | 'offline'
  currentLoad?: number | null
  maxConcurrency?: number | null
  queueLag?: number | null
  capabilityTags: string[]
  metadata?: Record<string, unknown>
  workspaceId: number
  actor: string
  actorId?: number
  ipAddress?: string | null
  userAgent?: string | null
}

export interface OpenClawHeartbeatResult {
  accepted: true
  server_time: number
}

export interface OpenClawProgressRequest {
  runId: string
  progress: number
  message?: string | null
  metrics?: Record<string, unknown>
  runtimeNodeId?: string | null
  runtimeSessionId?: string | null
  workspaceId: number
  actor: string
  actorId?: number
  ipAddress?: string | null
  userAgent?: string | null
}

export interface OpenClawProgressResult {
  run_id: string
  progress: number
  message: string | null
  metrics: Record<string, unknown>
  runtime_node_id: string | null
  runtime_session_id: string | null
  updated_at: string
}

export interface OpenClawSubmitRequest {
  runId: string
  status: 'completed' | 'failed' | 'cancelled'
  outcome?: 'success' | 'failure' | 'error' | 'timeout' | 'cancelled' | null
  result?: Record<string, unknown> | null
  artifacts?: Array<{
    type: string
    name: string
    path?: string
    content?: string
    metadata?: Record<string, unknown>
  }>
  logs?: Array<{
    level: 'info' | 'warn' | 'error' | 'debug'
    message: string
    timestamp?: number
    metadata?: Record<string, unknown>
  }>
  error?: string | null
  runtimeNodeId?: string | null
  runtimeSessionId?: string | null
  workspaceId: number
  actor: string
  actorId?: number
  ipAddress?: string | null
  userAgent?: string | null
}

export interface OpenClawSubmitResult {
  run_id: string
  status: string
  outcome: string | null
  submitted_at: number
  artifacts_count: number
  logs_count: number
}


function parseTaskMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return {}
  }
  return {}
}

function normalizeCapabilityTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index)
}

function hashSnapshot(snapshot: OpenClawExecutionSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

function mapNodeStatusToAgentStatus(status: OpenClawHeartbeatRequest['nodeStatus']): 'busy' | 'idle' | 'offline' | 'error' {
  switch (status) {
    case 'online':
      return 'idle'
    case 'busy':
      return 'busy'
    case 'offline':
      return 'offline'
    case 'idle':
      return 'idle'
    default:
      return 'error'
  }
}

export function getDispatchTaskOrThrow(
  db: Database.Database,
  dispatchId: number,
  workspaceId: number,
): OpenClawTaskRow {
  const task = db.prepare(
    'SELECT * FROM tasks WHERE id = ? AND workspace_id = ?'
  ).get(dispatchId, workspaceId) as OpenClawTaskRow | undefined

  if (!task) {
    throw new OpenClawRuntimeError('DISPATCH_NOT_FOUND', 'Dispatch not found', 404)
  }

  return task
}

export function buildExecutionSnapshot(task: OpenClawTaskRow, dispatchId: number): OpenClawExecutionSnapshot {
  const metadata = parseTaskMetadata(task.metadata)
  return {
    dispatch_id: dispatchId,
    task_id: task.id,
    title: task.title,
    description: task.description ?? null,
    status: task.status,
    priority: task.priority,
    assigned_to: task.assigned_to ?? null,
    metadata,
    ...resolveTaskImplementationTarget({ metadata }),
  }
}

function getClaim(
  db: Database.Database,
  dispatchId: number,
  workspaceId: number,
): OpenClawDispatchClaim | undefined {
  return db.prepare(
    'SELECT * FROM openclaw_dispatch_claims WHERE dispatch_id = ? AND workspace_id = ?'
  ).get(dispatchId, workspaceId) as OpenClawDispatchClaim | undefined
}

function getSnapshotRow(
  db: Database.Database,
  dispatchId: number,
  workspaceId: number,
): OpenClawExecutionSnapshotRow | undefined {
  return db.prepare(
    'SELECT * FROM openclaw_execution_snapshots WHERE dispatch_id = ? AND workspace_id = ?'
  ).get(dispatchId, workspaceId) as OpenClawExecutionSnapshotRow | undefined
}

function parseSnapshotRow(row: OpenClawExecutionSnapshotRow | undefined): OpenClawExecutionSnapshot | null {
  if (!row) return null
  return JSON.parse(row.snapshot_json) as OpenClawExecutionSnapshot
}

function resolveAgent(
  db: Database.Database,
  agentId: string,
  workspaceId: number,
): { id: number; name: string } {
  const agent = Number.isNaN(Number(agentId))
    ? db.prepare('SELECT id, name FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId)
    : db.prepare('SELECT id, name FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId)

  if (!agent) {
    throw new OpenClawRuntimeError('AGENT_NOT_FOUND', 'Agent not found', 404)
  }

  return agent as { id: number; name: string }
}

export function claimDispatch(db: Database.Database, input: OpenClawClaimRequest): OpenClawClaimResult {
  const task = getDispatchTaskOrThrow(db, input.dispatchId, input.workspaceId)

  const existing = getClaim(db, input.dispatchId, input.workspaceId)
  if (existing) {
    if (existing.agent_id === input.agentId && existing.runtime_session_id === input.runtimeSessionId) {
      // Find the associated run for this dispatch
      const existingRun = db.prepare(
        `SELECT id FROM runs WHERE metadata LIKE ? AND workspace_id = ? LIMIT 1`
      ).get(`%"dispatch_id":${input.dispatchId}%`, input.workspaceId) as { id: string } | undefined

      return {
        dispatch_id: existing.dispatch_id,
        task_id: existing.task_id,
        dispatch_status: 'acked',
        acked_at: existing.claimed_at,
        snapshot_hash: existing.snapshot_hash,
        run_id: existingRun?.id ?? '',
      }
    }

    throw new OpenClawRuntimeError(
      'DISPATCH_ALREADY_CLAIMED',
      'Dispatch already claimed by another runtime node',
      409,
    )
  }

  const snapshot = buildExecutionSnapshot(task, input.dispatchId)
  const snapshotHash = hashSnapshot(snapshot)
  const now = Math.floor(Date.now() / 1000)
  const capabilityTagsJson = JSON.stringify(normalizeCapabilityTags(input.capabilityTags))

  try {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO openclaw_execution_snapshots (dispatch_id, task_id, snapshot_json, snapshot_hash, created_at, workspace_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        input.dispatchId,
        task.id,
        JSON.stringify(snapshot),
        snapshotHash,
        now,
        input.workspaceId,
      )

      db.prepare(`
        INSERT INTO openclaw_dispatch_claims (
          dispatch_id,
          task_id,
          agent_id,
          runtime_node_id,
          runtime_session_id,
          capability_tags_json,
          snapshot_hash,
          claimed_at,
          workspace_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.dispatchId,
        task.id,
        input.agentId,
        input.runtimeNodeId,
        input.runtimeSessionId,
        capabilityTagsJson,
        snapshotHash,
        now,
        input.workspaceId,
      )
    })()
  } catch (error: any) {
    if (String(error?.message || '').includes('UNIQUE constraint failed')) {
      const claimed = getClaim(db, input.dispatchId, input.workspaceId)
      if (claimed?.agent_id === input.agentId && claimed.runtime_session_id === input.runtimeSessionId) {
        // Find the associated run for this dispatch
        const existingRun = db.prepare(
          `SELECT id FROM runs WHERE metadata LIKE ? AND workspace_id = ? LIMIT 1`
        ).get(`%"dispatch_id":${input.dispatchId}%`, input.workspaceId) as { id: string } | undefined

        return {
          dispatch_id: claimed.dispatch_id,
          task_id: claimed.task_id,
          dispatch_status: 'acked',
          acked_at: claimed.claimed_at,
          snapshot_hash: claimed.snapshot_hash,
          run_id: existingRun?.id ?? '',
        }
      }
      throw new OpenClawRuntimeError(
        'DISPATCH_ALREADY_CLAIMED',
        'Dispatch already claimed by another runtime node',
        409,
      )
    }
    throw error
  }

  db_helpers.logActivity(
    'openclaw_claimed',
    'task',
    task.id,
    input.agentId,
    `OpenClaw claimed dispatch ${input.dispatchId}`,
    {
      dispatch_id: input.dispatchId,
      runtime_node_id: input.runtimeNodeId,
      runtime_session_id: input.runtimeSessionId,
      capability_tags: normalizeCapabilityTags(input.capabilityTags),
      snapshot_hash: snapshotHash,
    },
    input.workspaceId,
  )

  logAuditEvent({
    action: 'openclaw_dispatch_claim',
    actor: input.actor,
    actor_id: input.actorId,
    target_type: 'task',
    target_id: task.id,
    detail: {
      dispatch_id: input.dispatchId,
      agent_id: input.agentId,
      runtime_node_id: input.runtimeNodeId,
      runtime_session_id: input.runtimeSessionId,
      snapshot_hash: snapshotHash,
    },
    ip_address: input.ipAddress ?? undefined,
    user_agent: input.userAgent ?? undefined,
  })

  // Create a run for this OpenClaw execution
  const run = createRun(
    {
      id: randomUUID(),
      agent_id: input.agentId,
      status: 'running',
      trigger: 'agent',
      runtime: 'openclaw',
      task_id: String(task.id),
      started_at: new Date(now * 1000).toISOString(),
      steps: [],
      cost: { input_tokens: 0, output_tokens: 0 },
      provenance: {
        run_hash: snapshotHash,
        runtime: 'openclaw',
        created_at: new Date(now * 1000).toISOString(),
      },
      metadata: {
        openclaw: {
          dispatch_id: input.dispatchId,
          runtime_node_id: input.runtimeNodeId,
          runtime_session_id: input.runtimeSessionId,
          snapshot_hash: snapshotHash,
        },
      },
    } as AgentRun,
    input.workspaceId,
  )

  return {
    dispatch_id: input.dispatchId,
    task_id: task.id,
    dispatch_status: 'acked',
    acked_at: now,
    snapshot_hash: snapshotHash,
    run_id: run.id,
  }
}

export function getExecutionSnapshotForAgent(
  db: Database.Database,
  input: OpenClawSnapshotRequest,
): OpenClawExecutionSnapshot {
  getDispatchTaskOrThrow(db, input.dispatchId, input.workspaceId)

  const claim = getClaim(db, input.dispatchId, input.workspaceId)
  if (!claim) {
    throw new OpenClawRuntimeError('DISPATCH_NOT_CLAIMED', 'Dispatch has not been claimed', 403)
  }

  if (claim.agent_id !== input.agentId || claim.runtime_session_id !== input.runtimeSessionId) {
    throw new OpenClawRuntimeError('RUN_NOT_OWNED_BY_AGENT', 'Dispatch snapshot is owned by another agent session', 403)
  }

  const snapshot = parseSnapshotRow(getSnapshotRow(db, input.dispatchId, input.workspaceId))
  if (!snapshot) {
    throw new OpenClawRuntimeError('DISPATCH_SNAPSHOT_MISSING', 'Dispatch snapshot not found', 500)
  }

  return snapshot
}

export function recordOpenClawHeartbeat(
  db: Database.Database,
  input: OpenClawHeartbeatRequest,
): OpenClawHeartbeatResult {
  const runtimeType = input.runtimeType ?? 'openclaw'
  if (runtimeType !== 'openclaw') {
    throw new OpenClawRuntimeError('INVALID_RUNTIME_TYPE', 'runtime_type must be openclaw', 400)
  }

  const agent = resolveAgent(db, input.agentId, input.workspaceId)
  const now = Math.floor(Date.now() / 1000)
  const capabilityTags = normalizeCapabilityTags(input.capabilityTags)
  const agentStatus = mapNodeStatusToAgentStatus(input.nodeStatus)
  const activity = `OpenClaw heartbeat (${input.runtimeNodeId}/${input.runtimeSessionId})`
  const detail = {
    agent_id: input.agentId,
    runtime_type: runtimeType,
    runtime_node_id: input.runtimeNodeId,
    runtime_session_id: input.runtimeSessionId,
    node_status: input.nodeStatus,
    current_load: input.currentLoad ?? null,
    max_concurrency: input.maxConcurrency ?? null,
    queue_lag: input.queueLag ?? null,
    capability_tags: capabilityTags,
    metadata: input.metadata ?? {},
  }

  db.prepare(`
    UPDATE agents
    SET status = ?, last_seen = ?, last_activity = ?, updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `).run(agentStatus, now, activity, now, agent.id, input.workspaceId)

  db.prepare(`
    INSERT INTO activities (type, entity_type, entity_id, actor, description, data, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'openclaw_heartbeat',
    'agent',
    agent.id,
    agent.name,
    `OpenClaw heartbeat received for ${agent.name}`,
    JSON.stringify(detail),
    input.workspaceId,
  )

  db.prepare(`
    INSERT INTO audit_log (action, actor, actor_id, target_type, target_id, detail, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'openclaw_heartbeat',
    input.actor,
    input.actorId ?? null,
    'agent',
    agent.id,
    JSON.stringify(detail),
    input.ipAddress ?? null,
    input.userAgent ?? null,
  )

  return {
    accepted: true,
    server_time: now,
  }
}

export function recordExecutionProgress(
  db: Database.Database,
  input: OpenClawProgressRequest,
): OpenClawProgressResult {
  const run = getRun(input.runId, input.workspaceId)
  if (!run) {
    throw new OpenClawRuntimeError('RUN_NOT_FOUND', 'Run not found', 404)
  }

  const existingMetadata = (run.metadata && typeof run.metadata === 'object') ? run.metadata : {}
  const existingOpenClaw =
    existingMetadata.openclaw && typeof existingMetadata.openclaw === 'object' && !Array.isArray(existingMetadata.openclaw)
      ? (existingMetadata.openclaw as Record<string, unknown>)
      : {}

  const runtimeSessionId = input.runtimeSessionId ?? (existingOpenClaw.runtime_session_id as string | undefined | null)
  if (runtimeSessionId && existingOpenClaw.runtime_session_id && runtimeSessionId !== existingOpenClaw.runtime_session_id) {
    throw new OpenClawRuntimeError('RUN_NOT_OWNED_BY_AGENT', 'Run belongs to a different runtime session', 403)
  }

  const runtimeNodeId = input.runtimeNodeId ?? (existingOpenClaw.runtime_node_id as string | undefined | null)
  const openclawMetadata = {
    progress: input.progress,
    message: input.message ?? null,
    metrics: input.metrics ?? {},
    runtime_node_id: runtimeNodeId,
    runtime_session_id: runtimeSessionId,
  }

  updateRun(input.runId, { metadata: { ...existingMetadata, openclaw: openclawMetadata } }, input.workspaceId)

  logAuditEvent({
    action: 'openclaw_progress',
    actor: input.actor,
    actor_id: input.actorId,
    target_type: 'run',
    target_id: parseInt(input.runId, 10) || undefined,
    detail: {
      run_id: input.runId,
      progress: input.progress,
      message: input.message,
      metrics: input.metrics,
      runtime_node_id: runtimeNodeId,
      runtime_session_id: runtimeSessionId,
    },
    ip_address: input.ipAddress ?? undefined,
    user_agent: input.userAgent ?? undefined,
  })

  return {
    run_id: input.runId,
    progress: input.progress,
    message: input.message ?? null,
    metrics: input.metrics ?? {},
    runtime_node_id: runtimeNodeId ?? null,
    runtime_session_id: runtimeSessionId ?? null,
    updated_at: new Date().toISOString(),
  }
}

export function submitExecutionResult(
  db: Database.Database,
  input: OpenClawSubmitRequest,
): OpenClawSubmitResult {
  const run = getRun(input.runId, input.workspaceId)
  if (!run) {
    throw new OpenClawRuntimeError('RUN_NOT_FOUND', 'Run not found', 404)
  }

  // Verify runtime session ownership if provided
  const existingMetadata = (run.metadata && typeof run.metadata === 'object') ? run.metadata : {}
  const existingOpenClaw =
    existingMetadata.openclaw && typeof existingMetadata.openclaw === 'object' && !Array.isArray(existingMetadata.openclaw)
      ? (existingMetadata.openclaw as Record<string, unknown>)
      : {}

  const runtimeSessionId = input.runtimeSessionId ?? (existingOpenClaw.runtime_session_id as string | undefined | null)
  if (runtimeSessionId && existingOpenClaw.runtime_session_id && runtimeSessionId !== existingOpenClaw.runtime_session_id) {
    throw new OpenClawRuntimeError('RUN_NOT_OWNED_BY_AGENT', 'Run belongs to a different runtime session', 403)
  }

  const now = Math.floor(Date.now() / 1000)
  const artifacts = input.artifacts ?? []
  const logs = input.logs ?? []

  // Build submission metadata
  const submissionMetadata = {
    ...existingMetadata,
    openclaw: {
      ...existingOpenClaw,
      runtime_node_id: input.runtimeNodeId ?? existingOpenClaw.runtime_node_id,
      runtime_session_id: runtimeSessionId,
      submission: {
        status: input.status,
        outcome: input.outcome as import("@/lib/runs").RunOutcome | null | undefined,
        result: input.result,
        artifacts: artifacts.map(a => ({ type: a.type, name: a.name, path: a.path, metadata: a.metadata })),
        logs: logs.map(l => ({ level: l.level, message: l.message, timestamp: l.timestamp })),
        error: input.error,
        submitted_at: now,
      },
    },
  }

  // Update run with final status
  updateRun(
    input.runId,
    {
      status: input.status,
      outcome: input.outcome as import("@/lib/runs").RunOutcome | null | undefined,
      metadata: submissionMetadata,
      ended_at: new Date().toISOString(),
    },
    input.workspaceId,
  )

  // Log submission
  logAuditEvent({
    action: 'openclaw_submit',
    actor: input.actor,
    actor_id: input.actorId,
    target_type: 'run',
    target_id: parseInt(input.runId, 10) || undefined,
    detail: {
      run_id: input.runId,
      status: input.status,
      outcome: input.outcome as import("@/lib/runs").RunOutcome | null | undefined,
      artifacts_count: artifacts.length,
      logs_count: logs.length,
      runtime_node_id: input.runtimeNodeId,
      runtime_session_id: runtimeSessionId,
    },
    ip_address: input.ipAddress ?? undefined,
    user_agent: input.userAgent ?? undefined,
  })

  return {
    run_id: input.runId,
    status: input.status,
    outcome: input.outcome ?? null,
    submitted_at: now,
    artifacts_count: artifacts.length,
    logs_count: logs.length,
  }
}

export interface OpenClawGetExecutionRequest {
  runId: string
  runtimeSessionId?: string | null
  workspaceId: number
  actor: string
  actorId?: number
  ipAddress?: string | null
  userAgent?: string | null
}

export interface OpenClawGetExecutionResult {
  run_id: string
  status: string
  outcome: string | null
  progress: number
  progress_message: string | null
  error: string | null
  started_at: string
  ended_at: string | null
  metadata: Record<string, unknown>
  runtime_session_id: string | null
}

export function getExecutionStatus(
  db: Database.Database,
  input: OpenClawGetExecutionRequest,
): OpenClawGetExecutionResult {
  const run = getRun(input.runId, input.workspaceId)
  if (!run) {
    throw new OpenClawRuntimeError('RUN_NOT_FOUND', 'Run not found', 404)
  }

  // Verify runtime session ownership if provided
  const existingMetadata = (run.metadata && typeof run.metadata === 'object') ? run.metadata : {}
  const existingOpenClaw =
    existingMetadata.openclaw && typeof existingMetadata.openclaw === 'object' && !Array.isArray(existingMetadata.openclaw)
      ? (existingMetadata.openclaw as Record<string, unknown>)
      : {}

  const runtimeSessionId = input.runtimeSessionId ?? (existingOpenClaw.runtime_session_id as string | undefined | null)
  if (runtimeSessionId && existingOpenClaw.runtime_session_id && runtimeSessionId !== existingOpenClaw.runtime_session_id) {
    throw new OpenClawRuntimeError('RUN_NOT_OWNED_BY_AGENT', 'Run belongs to a different runtime session', 403)
  }

  const progress = typeof existingOpenClaw.progress === 'number' ? existingOpenClaw.progress : 0
  const progressMessage = typeof existingOpenClaw.message === 'string' ? existingOpenClaw.message : null

  // Log query for audit trail
  logAuditEvent({
    action: 'openclaw_get_execution',
    actor: input.actor,
    actor_id: input.actorId,
    target_type: 'run',
    target_id: parseInt(input.runId, 10) || undefined,
    detail: {
      run_id: input.runId,
      status: run.status,
      runtime_session_id: runtimeSessionId,
    },
    ip_address: input.ipAddress ?? undefined,
    user_agent: input.userAgent ?? undefined,
  })

  return {
    run_id: run.id,
    status: run.status,
    outcome: run.outcome ?? null,
    progress,
    progress_message: progressMessage,
    error: run.error ?? null,
    started_at: run.started_at,
    ended_at: run.ended_at ?? null,
    metadata: existingMetadata,
    runtime_session_id: runtimeSessionId ?? null,
  }
}

export interface OpenClawCancelRequest {
  runId: string
  reason?: string | null
  runtimeSessionId?: string | null
  workspaceId: number
  actor: string
  actorId?: number
  ipAddress?: string | null
  userAgent?: string | null
}

export interface OpenClawCancelResult {
  run_id: string
  status: 'cancelled'
  outcome: 'cancelled'
  cancelled_at: number
  reason: string | null
}

export function cancelExecution(
  db: Database.Database,
  input: OpenClawCancelRequest,
): OpenClawCancelResult {
  const run = getRun(input.runId, input.workspaceId)
  if (!run) {
    throw new OpenClawRuntimeError('RUN_NOT_FOUND', 'Run not found', 404)
  }

  // Cannot cancel already completed runs
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    throw new OpenClawRuntimeError(
      'RUN_ALREADY_FINALIZED',
      `Run is already ${run.status} and cannot be cancelled`,
      409,
    )
  }

  // Verify runtime session ownership if provided
  const existingMetadata = (run.metadata && typeof run.metadata === 'object') ? run.metadata : {}
  const existingOpenClaw =
    existingMetadata.openclaw && typeof existingMetadata.openclaw === 'object' && !Array.isArray(existingMetadata.openclaw)
      ? (existingMetadata.openclaw as Record<string, unknown>)
      : {}

  const runtimeSessionId = input.runtimeSessionId ?? (existingOpenClaw.runtime_session_id as string | undefined | null)
  if (runtimeSessionId && existingOpenClaw.runtime_session_id && runtimeSessionId !== existingOpenClaw.runtime_session_id) {
    throw new OpenClawRuntimeError('RUN_NOT_OWNED_BY_AGENT', 'Run belongs to a different runtime session', 403)
  }

  const now = Math.floor(Date.now() / 1000)

  // Update run with cancelled status
  const cancelledMetadata = {
    ...existingMetadata,
    openclaw: {
      ...existingOpenClaw,
      cancellation: {
        reason: input.reason ?? null,
        cancelled_at: now,
        cancelled_by: input.actor,
      },
    },
  }

  updateRun(
    input.runId,
    {
      status: 'cancelled',
      outcome: 'cancelled',
      metadata: cancelledMetadata,
      ended_at: new Date().toISOString(),
    },
    input.workspaceId,
  )

  // Log cancellation
  logAuditEvent({
    action: 'openclaw_cancel',
    actor: input.actor,
    actor_id: input.actorId,
    target_type: 'run',
    target_id: parseInt(input.runId, 10) || undefined,
    detail: {
      run_id: input.runId,
      reason: input.reason,
      runtime_session_id: runtimeSessionId,
    },
    ip_address: input.ipAddress ?? undefined,
    user_agent: input.userAgent ?? undefined,
  })

  return {
    run_id: input.runId,
    status: 'cancelled',
    outcome: 'cancelled',
    cancelled_at: now,
    reason: input.reason ?? null,
  }
}
