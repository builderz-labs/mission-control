import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { type OpenClawDispatchClaim, type OpenClawExecutionSnapshotRow, type OpenClawTaskRow, db_helpers, logAuditEvent } from '@/lib/db'
import { getRun, updateRun, createRun, attachEval, type AgentRun, type EvalResult } from '@/lib/runs'
import { resolveTaskImplementationTarget } from '@/lib/task-routing'
import { eventBus } from './event-bus'
import { logger } from './logger'

/**
 * OpenClaw task metadata structure stored in tasks.metadata JSON field.
 * Used to identify OpenClaw runtime tasks and store execution context.
 */
export interface OpenClawTaskMetadata {
  runtime_type?: 'openclaw'

  openclaw?: {
    dispatch_id?: number
    runtime_session_id?: string
    runtime_node_id?: string
    run_id?: string

    implementation_repo?: string
    code_location?: string

    strategy?: 'claim_then_execute' | 'direct_dispatch'
    progress_interval?: number
    auto_validate?: boolean

    submission?: {
      status: string
      outcome?: string
      result?: Record<string, unknown>
      error?: string
      submitted_at: number
      auto_validate?: boolean
      artifacts?: Array<{
        type: string
        name: string
        path?: string
        metadata?: Record<string, unknown>
      }>
      logs?: Array<{
        level: 'info' | 'warn' | 'error' | 'debug'
        message: string
        timestamp?: number
      }>
      eval_result?: EvalResult | null
    }
  }
}

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
  auto_validate?: boolean | null
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
  eval_result?: {
    pass: boolean
    score: number
    detail?: string
    eval_layer?: string
    task_type?: string
    metrics?: Record<string, unknown>
  } | null
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

  // ★ Broadcast progress event for real-time updates
  eventBus.broadcast('run.updated', {
    run_id: input.runId,
    progress: input.progress,
    message: input.message,
    metrics: input.metrics,
    runtime_session_id: runtimeSessionId,
    runtime_node_id: runtimeNodeId,
    source: 'openclaw',
  })

  // Optional: Update associated task with progress (every 20% to reduce noise)
  const taskId = getTaskIdFromRun(run)
  if (taskId && input.progress % 20 === 0) {
    eventBus.broadcast('task.updated', {
      id: taskId,
      execution_progress: input.progress,
      execution_message: input.message,
      run_id: input.runId,
    })
  }

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

/**
 * Check if a task is an OpenClaw runtime task based on metadata.
 */
export function isOpenClawTask(taskMetadata: Record<string, unknown> | null | undefined): boolean {
  if (!taskMetadata) return false
  return taskMetadata.runtime_type === 'openclaw'
}

/**
 * Get task ID from run metadata.
 * Returns null if not associated with a task.
 */
function getTaskIdFromRun(run: AgentRun): number | null {
  const taskId = run.metadata?.task_id
  if (typeof taskId === 'string') {
    const parsed = parseInt(taskId, 10)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof taskId === 'number') {
    return taskId
  }
  return null
}

/**
 * Transition task status and broadcast event.
 * Implements retry logic: on failure, requeue to 'assigned' up to MAX_RETRIES times.
 */
function transitionTaskStatus(
  db: Database.Database,
  taskId: number,
  newStatus: string,
  updates: {
    resolution?: string
    outcome?: string
    error_message?: string
    dispatch_attempts?: number
    run_id?: string
  },
  workspaceId: number,
) {
  const now = Math.floor(Date.now() / 1000)

  db.prepare(`
    UPDATE tasks
    SET status = ?, updated_at = ?,
        resolution = COALESCE(?, resolution),
        outcome = COALESCE(?, outcome),
        error_message = COALESCE(?, error_message),
        dispatch_attempts = COALESCE(?, dispatch_attempts)
    WHERE id = ? AND workspace_id = ?
  `).run(
    newStatus,
    now,
    updates.resolution ?? null,
    updates.outcome ?? null,
    updates.error_message ?? null,
    updates.dispatch_attempts ?? null,
    taskId,
    workspaceId,
  )

  // Broadcast task status change
  eventBus.broadcast('task.status_changed', {
    id: taskId,
    status: newStatus,
    reason: 'openclaw_execution_complete',
    run_id: updates.run_id,
    outcome: updates.outcome,
  })
}

const MAX_TASK_RETRIES = 3

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
  const autoValidate = input.auto_validate ?? existingOpenClaw.auto_validate === true

  // Auto-generate validation result if requested
  let evalResult: EvalResult | null = null
  if (autoValidate) {
    const pass = input.status === 'completed' && input.outcome === 'success'
    const score = pass ? 1.0 : 0.0
    const detail = pass
      ? 'Auto-validation: execution completed successfully'
      : `Auto-validation: execution ${input.status}${input.error ? ` - ${input.error}` : ''}`

    evalResult = {
      task_type: 'openclaw_execution',
      eval_layer: 'auto',
      pass,
      score,
      expected_outcome: 'success',
      actual_outcome: input.outcome ?? input.status,
      detail,
      metrics: {
        status: input.status,
        outcome: input.outcome ?? null,
        artifacts_count: artifacts.length,
        logs_count: logs.length,
        has_error: !!input.error,
      },
    }
  }

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
        auto_validate: autoValidate,
        eval_result: evalResult,
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
      auto_validate: autoValidate,
      eval_pass: evalResult?.pass ?? null,
      eval_score: evalResult?.score ?? null,
    },
    ip_address: input.ipAddress ?? undefined,
    user_agent: input.userAgent ?? undefined,
  })

  if (evalResult) {
    attachEval(input.runId, evalResult, input.workspaceId)

    // Log auto-validation
    logAuditEvent({
      action: 'openclaw_auto_validate',
      actor: input.actor,
      actor_id: input.actorId,
      target_type: 'run',
      target_id: parseInt(input.runId, 10) || undefined,
      detail: {
        run_id: input.runId,
        pass: evalResult.pass,
        score: evalResult.score,
        eval_layer: evalResult.eval_layer,
      },
      ip_address: input.ipAddress ?? undefined,
      user_agent: input.userAgent ?? undefined,
    })
  }

  eventBus.broadcast('run.completed', {
    run_id: input.runId,
    status: input.status,
    outcome: input.outcome ?? null,
    runtime_session_id: runtimeSessionId ?? null,
    runtime_node_id: input.runtimeNodeId ?? (existingOpenClaw.runtime_node_id as string | null | undefined) ?? null,
    artifacts_count: artifacts.length,
    logs_count: logs.length,
    eval_result: evalResult
      ? {
          pass: evalResult.pass,
          score: evalResult.score,
          eval_layer: evalResult.eval_layer ?? null,
          task_type: evalResult.task_type ?? null,
        }
      : null,
    source: 'openclaw',
  })

  // ★ Drive associated task status transition
  const taskId = getTaskIdFromRun(run)
  if (taskId) {
    try {
      const taskRow = db.prepare(
        'SELECT id, status, dispatch_attempts, metadata FROM tasks WHERE id = ? AND workspace_id = ?'
      ).get(taskId, input.workspaceId) as { id: number; status: string; dispatch_attempts: number; metadata: string | null } | undefined

      if (taskRow) {
        const currentAttempts = taskRow.dispatch_attempts ?? 0

        if (input.status === 'completed' && input.outcome === 'success') {
          // Success → review status (await human/Aegis review)
          const resolutionSummary = formatExecutionResultComment(input, evalResult).substring(0, 5000)

          transitionTaskStatus(
            db,
            taskId,
            'review',
            {
              resolution: resolutionSummary,
              outcome: 'success',
              run_id: input.runId,
            },
            input.workspaceId,
          )

          // Add comment with execution result
          const now = Math.floor(Date.now() / 1000)
          const agentName = run.agent_id || 'openclaw'
          const commentContent = formatExecutionResultComment(input, evalResult)

          db.prepare(`
            INSERT INTO comments (task_id, author, content, created_at, workspace_id)
            VALUES (?, ?, ?, ?, ?)
          `).run(taskId, agentName, commentContent, now, input.workspaceId)

          // Log activity
          db_helpers.logActivity(
            'openclaw_task_completed',
            'task',
            taskId,
            agentName,
            `OpenClaw execution completed for task ${taskId}`,
            { run_id: input.runId, status: input.status, outcome: input.outcome },
            input.workspaceId,
          )
        } else if (input.status === 'failed' || input.status === 'cancelled') {
          // Failure/Cancel → retry or move to failed
          const newAttempts = currentAttempts + 1
          const errorMsg = input.error || `Execution ${input.status}`

          if (newAttempts >= MAX_TASK_RETRIES) {
            // Max retries exceeded → failed
            transitionTaskStatus(
              db,
              taskId,
              'failed',
              {
                error_message: errorMsg.substring(0, 5000),
                outcome: 'failed',
                dispatch_attempts: newAttempts,
              },
              input.workspaceId,
            )

            eventBus.broadcast('task.status_changed', {
              id: taskId,
              status: 'failed',
              reason: 'openclaw_max_retries_exceeded',
              attempts: newAttempts,
              error: errorMsg,
            })
          } else {
            // Retry → back to assigned
            transitionTaskStatus(
              db,
              taskId,
              'assigned',
              {
                error_message: `Execution ${input.status}: ${errorMsg}. Will retry (attempt ${newAttempts}/${MAX_TASK_RETRIES}).`,
                dispatch_attempts: newAttempts,
              },
              input.workspaceId,
            )

            // Add retry comment
            const now = Math.floor(Date.now() / 1000)
            db.prepare(`
              INSERT INTO comments (task_id, author, content, created_at, workspace_id)
              VALUES (?, ?, ?, ?, ?)
            `).run(
              taskId,
              'scheduler',
              `Execution ${input.status} (attempt ${currentAttempts}/${MAX_TASK_RETRIES}): ${errorMsg.substring(0, 1000)}`,
              now,
              input.workspaceId,
            )
          }
        }
      }
    } catch (err) {
      // Log error but don't fail the submission
      logger.error({ err, taskId, runId: input.runId }, 'Failed to transition task status after OpenClaw execution')
    }
  }

  return {
    run_id: input.runId,
    status: input.status,
    outcome: input.outcome ?? null,
    submitted_at: now,
    artifacts_count: artifacts.length,
    logs_count: logs.length,
    eval_result: evalResult
      ? {
          pass: evalResult.pass,
          score: evalResult.score,
          detail: evalResult.detail ?? undefined,
          eval_layer: evalResult.eval_layer ?? undefined,
          task_type: evalResult.task_type ?? undefined,
          metrics: evalResult.metrics,
        }
      : null,
  }
}

/**
 * Format execution result as a comment for the task.
 */
function formatExecutionResultComment(input: OpenClawSubmitRequest, evalResult?: EvalResult | null): string {
  const lines = [
    '**Execution Result**',
    '',
    `Status: ${input.status}`,
    input.outcome ? `Outcome: ${input.outcome}` : null,
    input.error ? `Error: ${input.error}` : null,
  ]

  if (input.result && typeof input.result === 'object') {
    const resultPreview = JSON.stringify(input.result, null, 2)
    lines.push('', '**Result:**', '```json', resultPreview.substring(0, 2000), '```')
  }

  if (input.artifacts && input.artifacts.length > 0) {
    lines.push('', `**Artifacts:** ${input.artifacts.length}`)
    input.artifacts.slice(0, 5).forEach((a, i) => {
      lines.push(`${i + 1}. ${a.name} (${a.type})`)
    })
    if (input.artifacts.length > 5) {
      lines.push(`... and ${input.artifacts.length - 5} more`)
    }
  }

  if (input.logs && input.logs.length > 0) {
    lines.push('', `**Logs:** ${input.logs.length}`)
  }

  if (evalResult) {
    lines.push(
      '',
      '**Auto Validation:**',
      `Pass: ${evalResult.pass ? 'yes' : 'no'}`,
      `Score: ${evalResult.score}`,
      evalResult.detail ? `Detail: ${evalResult.detail}` : null,
    )
  }

  return lines.filter(Boolean).join('\n')
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
  artifacts: Array<{
    type: string
    name: string
    path?: string
    metadata?: Record<string, unknown>
  }>
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
  const artifacts = Array.isArray(existingOpenClaw.submission?.artifacts)
    ? existingOpenClaw.submission.artifacts
        .filter((artifact): artifact is Record<string, unknown> => !!artifact && typeof artifact === 'object' && !Array.isArray(artifact))
        .map((artifact) => ({
          type: typeof artifact.type === 'string' ? artifact.type : '',
          name: typeof artifact.name === 'string' ? artifact.name : '',
          path: typeof artifact.path === 'string' ? artifact.path : undefined,
          metadata:
            artifact.metadata && typeof artifact.metadata === 'object' && !Array.isArray(artifact.metadata)
              ? (artifact.metadata as Record<string, unknown>)
              : undefined,
        }))
        .filter((artifact) => artifact.type.length > 0 && artifact.name.length > 0)
    : []

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
    artifacts,
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

  eventBus.broadcast('run.completed', {
    run_id: input.runId,
    status: 'cancelled',
    outcome: 'cancelled',
    runtime_session_id: runtimeSessionId ?? null,
    runtime_node_id: (existingOpenClaw.runtime_node_id as string | null | undefined) ?? null,
    reason: input.reason ?? null,
    source: 'openclaw',
  })

  return {
    run_id: input.runId,
    status: 'cancelled',
    outcome: 'cancelled',
    cancelled_at: now,
    reason: input.reason ?? null,
  }
}
