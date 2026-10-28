import { getDatabase } from '@/lib/db'
import type {
  FactoryApprovalRequest,
  FactoryInstanceRecord,
  FactorySnapshot,
} from './types'
import type { FactoryDiscoveredInstance } from './adapters/factory-adapter'

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export interface FactoryInstanceView extends FactoryInstanceRecord {
  config_json: Record<string, unknown>
  latest_snapshot: FactorySnapshot | null
}

export function upsertFactoryInstance(workspaceId: number, instance: FactoryDiscoveredInstance): FactoryInstanceRecord {
  const db = getDatabase()
  db.prepare(`
    INSERT INTO factory_instances (
      workspace_id, instance_id, module_id, adapter_id, native_id, root_path, enabled, config, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, unixepoch(), unixepoch())
    ON CONFLICT(workspace_id, instance_id) DO UPDATE SET
      module_id = excluded.module_id,
      adapter_id = excluded.adapter_id,
      native_id = excluded.native_id,
      root_path = excluded.root_path,
      config = excluded.config,
      updated_at = unixepoch()
  `).run(
    workspaceId,
    instance.instance_id,
    instance.module_id,
    instance.adapter_id,
    instance.native_id,
    instance.root_path,
    JSON.stringify(instance.config || {}),
  )
  return db.prepare(`
    SELECT * FROM factory_instances
    WHERE workspace_id = ? AND instance_id = ?
  `).get(workspaceId, instance.instance_id) as FactoryInstanceRecord
}

export function listFactoryInstances(workspaceId: number): FactoryInstanceView[] {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT * FROM factory_instances
    WHERE workspace_id = ? AND enabled = 1
    ORDER BY module_id, native_id
  `).all(workspaceId) as FactoryInstanceRecord[]

  return rows.map((row) => {
    const snapshotRow = db.prepare(`
      SELECT snapshot FROM factory_snapshots
      WHERE workspace_id = ? AND instance_id = ?
      ORDER BY observed_at DESC, id DESC
      LIMIT 1
    `).get(workspaceId, row.instance_id) as { snapshot?: string } | undefined
    return {
      ...row,
      config_json: parseJson<Record<string, unknown>>(row.config, {}),
      latest_snapshot: snapshotRow?.snapshot ? parseJson<FactorySnapshot | null>(snapshotRow.snapshot, null) : null,
    }
  })
}

export function getFactoryInstance(workspaceId: number, instanceId: string): FactoryInstanceView | null {
  return listFactoryInstances(workspaceId).find((row) => row.instance_id === instanceId) || null
}

export function saveFactorySnapshot(workspaceId: number, snapshot: FactorySnapshot): FactorySnapshot {
  const db = getDatabase()
  const observed = Math.floor(Date.parse(snapshot.observed_at) / 1000) || Math.floor(Date.now() / 1000)
  const latest = db.prepare(`
    SELECT id, source_revision, freshness_state
    FROM factory_snapshots
    WHERE workspace_id = ? AND instance_id = ?
    ORDER BY observed_at DESC, id DESC
    LIMIT 1
  `).get(workspaceId, snapshot.instance_id) as { id: number; source_revision: string | null; freshness_state: string } | undefined

  if (latest && latest.source_revision === snapshot.source.revision && latest.freshness_state === snapshot.freshness.state) {
    db.prepare(`
      UPDATE factory_snapshots
      SET observed_at = ?, snapshot = ?, last_error = ?
      WHERE id = ?
    `).run(observed, JSON.stringify(snapshot), snapshot.freshness.last_error, latest.id)
    return snapshot
  }

  db.prepare(`
    INSERT INTO factory_snapshots (
      workspace_id, instance_id, snapshot_version, source_revision, observed_at,
      freshness_state, snapshot, last_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workspaceId,
    snapshot.instance_id,
    snapshot.snapshot_version,
    snapshot.source.revision,
    observed,
    snapshot.freshness.state,
    JSON.stringify(snapshot),
    snapshot.freshness.last_error,
  )
  return snapshot
}

export function saveFactorySnapshotError(
  workspaceId: number,
  instanceId: string,
  moduleId: string,
  nativeId: string,
  authority: string,
  error: string,
): FactorySnapshot {
  const now = new Date().toISOString()
  const snapshot: FactorySnapshot = {
    snapshot_version: '1.0',
    instance_id: instanceId,
    module_id: moduleId,
    observed_at: now,
    source: {
      authority,
      native_id: nativeId,
      revision: 'unavailable',
      adapter_version: '1',
    },
    freshness: {
      state: 'error',
      last_success_at: null,
      last_error: error,
    },
    lifecycle: {
      process_stage_id: null,
      native_stage: null,
      canonical_phase: 'unknown',
      status: 'failed',
    },
    compatibility: {
      native_version: 'unknown',
      contract_coverage: 'unknown',
      warnings: [error],
    },
    gates: [],
    checks: [],
    artifacts: [],
    review_queues: [],
    next_actions: [],
    blockers: [{ id: 'snapshot:error', label: 'Factory snapshot unavailable', detail: error, source: 'adapter' }],
    risks: [],
    metrics: [],
    available_commands: [],
  }
  return saveFactorySnapshot(workspaceId, snapshot)
}

export function syncOpenApprovalRequests(workspaceId: number, snapshot: FactorySnapshot): void {
  const db = getDatabase()
  const openNativeGates = snapshot.gates.filter((gate) => gate.state === 'open' && gate.blocking)

  for (const gate of openNativeGates) {
    const requestId = `${snapshot.instance_id}:gate:${gate.id}:${snapshot.source.revision}`
    db.prepare(`
      INSERT INTO factory_approval_requests (
        workspace_id, request_id, instance_id, gate_id, title, description, state,
        expected_revision, evidence_refs, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, unixepoch(), unixepoch())
      ON CONFLICT(workspace_id, request_id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        updated_at = unixepoch()
    `).run(
      workspaceId,
      requestId,
      snapshot.instance_id,
      gate.id,
      `${snapshot.source.native_id}: ${gate.id}`,
      gate.note || `Native Factory gate ${gate.id} requires a human decision.`,
      snapshot.source.revision,
      JSON.stringify(gate.evidence_refs || []),
    )

    db.prepare(`
      UPDATE factory_approval_requests
      SET state = 'STALE', updated_at = unixepoch()
      WHERE workspace_id = ? AND instance_id = ? AND gate_id = ?
        AND expected_revision <> ?
        AND state IN ('OPEN', 'DECISION_RECORDED')
    `).run(workspaceId, snapshot.instance_id, gate.id, snapshot.source.revision)
  }

  const activeRows = db.prepare(`
    SELECT id, gate_id, state
    FROM factory_approval_requests
    WHERE workspace_id = ? AND instance_id = ?
      AND state IN ('OPEN', 'DECISION_RECORDED')
  `).all(workspaceId, snapshot.instance_id) as Array<{ id: number; gate_id: string; state: string }>

  for (const row of activeRows) {
    const native = snapshot.gates.find((gate) => gate.id === row.gate_id)
    if (!native || native.state !== 'open') {
      db.prepare(`
        UPDATE factory_approval_requests
        SET state = 'STALE', updated_at = unixepoch()
        WHERE id = ?
      `).run(row.id)
    }
  }
}

export function listFactoryApprovals(workspaceId: number, states?: string[]): FactoryApprovalRequest[] {
  const db = getDatabase()
  if (states && states.length > 0) {
    const placeholders = states.map(() => '?').join(',')
    return db.prepare(`
      SELECT * FROM factory_approval_requests
      WHERE workspace_id = ? AND state IN (${placeholders})
      ORDER BY created_at DESC
    `).all(workspaceId, ...states) as FactoryApprovalRequest[]
  }
  return db.prepare(`
    SELECT * FROM factory_approval_requests
    WHERE workspace_id = ?
    ORDER BY created_at DESC
  `).all(workspaceId) as FactoryApprovalRequest[]
}


export function getFactoryApproval(workspaceId: number, requestId: string): FactoryApprovalRequest | null {
  const db = getDatabase()
  return db.prepare(`
    SELECT * FROM factory_approval_requests
    WHERE workspace_id = ? AND request_id = ?
    LIMIT 1
  `).get(workspaceId, requestId) as FactoryApprovalRequest | undefined || null
}

export function recordFactoryApprovalDecision(input: {
  workspaceId: number
  requestId: string
  decision: 'approve' | 'revise' | 'hold'
  note: string
  actor: string
  expectedRevision: string
  nativeResult?: Record<string, unknown> | null
}): FactoryApprovalRequest {
  const db = getDatabase()
  const current = getFactoryApproval(input.workspaceId, input.requestId)
  if (!current) throw new Error('Factory approval request not found')
  if (current.state !== 'OPEN') {
    throw new Error(`Factory approval is not open: ${current.state}`)
  }
  if (current.expected_revision && current.expected_revision !== input.expectedRevision) {
    throw new Error('Factory approval revision changed. Refresh before deciding.')
  }

  const nextState = input.decision === 'approve'
    ? 'DECISION_RECORDED'
    : input.decision === 'hold' ? 'HELD' : 'REVISION_REQUESTED'
  const nativeResult = input.decision === 'approve'
    ? input.nativeResult ? JSON.stringify(input.nativeResult) : null
    : JSON.stringify({ local_decision_only: true, decision: input.decision, pending_native_change: false })

  const changed = db.prepare(`
    UPDATE factory_approval_requests
    SET state = ?, decision = ?, decision_note = ?, decision_by = ?,
        decision_at = unixepoch(), expected_revision = ?, native_result = ?, updated_at = unixepoch()
    WHERE workspace_id = ? AND request_id = ? AND state = 'OPEN' AND expected_revision = ?
  `).run(
    nextState,
    input.decision,
    input.note || null,
    input.actor,
    input.expectedRevision,
    nativeResult,
    input.workspaceId,
    input.requestId,
    input.expectedRevision,
  )
  if (changed.changes !== 1) throw new Error('Factory approval changed before the decision was recorded.')

  return getFactoryApproval(input.workspaceId, input.requestId)!
}

export function claimFactoryApproval(workspaceId: number, requestId: string): boolean {
  const changed = getDatabase().prepare(`
    UPDATE factory_approval_requests
    SET state = 'APPLYING', updated_at = unixepoch()
    WHERE workspace_id = ? AND request_id = ?
      AND state = 'DECISION_RECORDED' AND decision = 'approve'
  `).run(workspaceId, requestId)
  return changed.changes === 1
}

export function updateFactoryApprovalState(input: {
  workspaceId: number
  requestId: string
  state: FactoryApprovalRequest['state']
  nativeResult?: Record<string, unknown> | null
}): FactoryApprovalRequest {
  const db = getDatabase()
  db.prepare(`
    UPDATE factory_approval_requests
    SET state = ?, native_result = COALESCE(?, native_result), updated_at = unixepoch()
    WHERE workspace_id = ? AND request_id = ?
  `).run(
    input.state,
    input.nativeResult ? JSON.stringify(input.nativeResult) : null,
    input.workspaceId,
    input.requestId,
  )
  const row = getFactoryApproval(input.workspaceId, input.requestId)
  if (!row) throw new Error('Factory approval request not found after update')
  return row
}

export interface FactoryCommandRunRecord {
  id: number
  workspace_id: number
  run_id: string
  instance_id: string
  command_id: string
  arguments: string
  risk: string
  state: string
  requested_by: string | null
  before_revision: string | null
  after_revision: string | null
  stdout_excerpt: string | null
  stderr_excerpt: string | null
  error: string | null
  started_at: number | null
  completed_at: number | null
  created_at: number
}

export function createFactoryCommandRun(input: {
  workspaceId: number
  runId: string
  instanceId: string
  commandId: string
  arguments: Record<string, unknown>
  risk: string
  requestedBy: string
  beforeRevision?: string | null
}): FactoryCommandRunRecord {
  const db = getDatabase()
  db.prepare(`
    INSERT INTO factory_command_runs (
      workspace_id, run_id, instance_id, command_id, arguments, risk, state,
      requested_by, before_revision, started_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?, unixepoch(), unixepoch())
  `).run(
    input.workspaceId,
    input.runId,
    input.instanceId,
    input.commandId,
    JSON.stringify(input.arguments || {}),
    input.risk,
    input.requestedBy,
    input.beforeRevision || null,
  )
  return db.prepare(`
    SELECT * FROM factory_command_runs
    WHERE workspace_id = ? AND run_id = ?
  `).get(input.workspaceId, input.runId) as FactoryCommandRunRecord
}

export function completeFactoryCommandRun(input: {
  workspaceId: number
  runId: string
  state: string
  afterRevision?: string | null
  stdoutExcerpt?: string
  stderrExcerpt?: string
  error?: string | null
}): FactoryCommandRunRecord {
  const db = getDatabase()
  db.prepare(`
    UPDATE factory_command_runs
    SET state = ?, after_revision = ?, stdout_excerpt = ?, stderr_excerpt = ?,
        error = ?, completed_at = unixepoch()
    WHERE workspace_id = ? AND run_id = ?
  `).run(
    input.state,
    input.afterRevision || null,
    input.stdoutExcerpt || null,
    input.stderrExcerpt || null,
    input.error || null,
    input.workspaceId,
    input.runId,
  )
  return db.prepare(`
    SELECT * FROM factory_command_runs
    WHERE workspace_id = ? AND run_id = ?
  `).get(input.workspaceId, input.runId) as FactoryCommandRunRecord
}

export function listFactoryCommandRuns(workspaceId: number, limit = 50): FactoryCommandRunRecord[] {
  return getDatabase().prepare(`
    SELECT * FROM factory_command_runs
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspaceId, Math.max(1, Math.min(200, limit))) as FactoryCommandRunRecord[]
}
