import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { type OpenClawDispatchClaim, type OpenClawExecutionSnapshotRow, type OpenClawTaskRow, db_helpers, logAuditEvent } from '@/lib/db'
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

export function claimDispatch(db: Database.Database, input: OpenClawClaimRequest): OpenClawClaimResult {
  const task = getDispatchTaskOrThrow(db, input.dispatchId, input.workspaceId)

  const existing = getClaim(db, input.dispatchId, input.workspaceId)
  if (existing) {
    if (existing.agent_id === input.agentId && existing.runtime_session_id === input.runtimeSessionId) {
      return {
        dispatch_id: existing.dispatch_id,
        task_id: existing.task_id,
        dispatch_status: 'acked',
        acked_at: existing.claimed_at,
        snapshot_hash: existing.snapshot_hash,
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
        return {
          dispatch_id: claimed.dispatch_id,
          task_id: claimed.task_id,
          dispatch_status: 'acked',
          acked_at: claimed.claimed_at,
          snapshot_hash: claimed.snapshot_hash,
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

  return {
    dispatch_id: input.dispatchId,
    task_id: task.id,
    dispatch_status: 'acked',
    acked_at: now,
    snapshot_hash: snapshotHash,
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
