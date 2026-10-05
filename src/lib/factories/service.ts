import { randomUUID } from 'node:crypto'
import { getFactoryAdapter, listFactoryAdapters } from './registry'
import {
  claimFactoryApproval,
  completeFactoryCommandRun,
  createFactoryCommandRun,
  getFactoryApproval,
  getFactoryInstance,
  listFactoryApprovals,
  listFactoryInstances,
  saveFactorySnapshot,
  saveFactorySnapshotError,
  syncOpenApprovalRequests,
  updateFactoryApprovalState,
  upsertFactoryInstance,
} from './store'
import type { FactorySnapshot } from './types'
import { recordExperience, recordFactorySnapshotExperience } from './learning-store'

export async function discoverFactories(workspaceId: number) {
  const discovered = []
  for (const adapter of listFactoryAdapters()) {
    const instances = await adapter.discoverInstances()
    for (const instance of instances) {
      discovered.push(upsertFactoryInstance(workspaceId, instance))
    }
  }
  return discovered
}

export async function refreshFactoryInstance(workspaceId: number, instanceId: string): Promise<FactorySnapshot> {
  const instance = getFactoryInstance(workspaceId, instanceId)
  if (!instance) throw new Error('Factory instance not found')

  const adapter = getFactoryAdapter(instance.adapter_id)
  if (!adapter) throw new Error(`Factory adapter not registered: ${instance.adapter_id}`)

  const discovered = {
    instance_id: instance.instance_id,
    module_id: instance.module_id,
    adapter_id: instance.adapter_id,
    native_id: instance.native_id,
    root_path: instance.root_path || '',
    config: instance.config_json,
  }

  try {
    const snapshot = await adapter.getSnapshot(discovered)
    saveFactorySnapshot(workspaceId, snapshot)
    recordFactorySnapshotExperience(workspaceId, snapshot)
    syncOpenApprovalRequests(workspaceId, snapshot)
    return snapshot
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Factory refresh failed'
    const snapshot = saveFactorySnapshotError(
      workspaceId,
      instance.instance_id,
      instance.module_id,
      instance.native_id,
      instance.root_path || '',
      message,
    )
    recordFactorySnapshotExperience(workspaceId, snapshot)
    return snapshot
  }
}

export async function discoverAndRefreshFactories(workspaceId: number) {
  await discoverFactories(workspaceId)
  const rows = listFactoryInstances(workspaceId)
  const snapshots: FactorySnapshot[] = []
  for (const row of rows) {
    snapshots.push(await refreshFactoryInstance(workspaceId, row.instance_id))
  }
  return snapshots
}


export async function processFactoryApproval(workspaceId: number, requestId: string) {
  const approval = getFactoryApproval(workspaceId, requestId)
  if (!approval) throw new Error('Factory approval request not found')
  if (approval.state !== 'DECISION_RECORDED' || approval.decision !== 'approve') {
    return { approval, processed: false, reason: 'Approval is not awaiting native application.' }
  }

  const instance = getFactoryInstance(workspaceId, approval.instance_id)
  if (!instance) throw new Error('Factory instance not found for approval')
  const adapter = getFactoryAdapter(instance.adapter_id)
  if (!adapter?.execute) throw new Error('Factory adapter has no controlled write path')

  const definition = adapter.getDefinition()
  const gateDefinition = definition.gates.find((gate) =>
    approval.gate_id === gate.id || approval.gate_id.startsWith(gate.id + ':'),
  )
  const commandId = gateDefinition?.apply_command || null
  if (!commandId) throw new Error('Factory gate has no approved symbolic apply command')
  const commandDefinition = definition.commands.find((command) => command.id === commandId)
  if (!commandDefinition || commandDefinition.mode !== 'mutating') {
    throw new Error('Factory gate apply command is not a registered mutating command')
  }
  const storedDecision = approval.native_result ? (() => {
    try { return JSON.parse(approval.native_result) as { publish_evidence?: unknown } } catch { return {} }
  })() : {}
  const publishEvidence = approval.gate_id.startsWith('publish:') ? storedDecision.publish_evidence : undefined
  const commandArguments = {
    gate: approval.gate_id,
    note: approval.decision_note || '',
    ...(approval.gate_id.startsWith('publish:') ? { publish_evidence: publishEvidence, human_approved: true } : {}),
  }
  const executeRequest = {
    command_id: commandId,
    arguments: commandArguments,
    expected_revision: approval.expected_revision,
    requested_by: approval.decision_by || 'local-owner',
  }
  const currentAvailability = instance.latest_snapshot
    ? adapter.canExecute?.(instance.latest_snapshot, executeRequest)
      || instance.latest_snapshot.available_commands.find((command) => command.command_id === commandId)
    : null
  if (currentAvailability?.available === false) {
    throw new Error(currentAvailability.reason || 'Factory command is currently unavailable')
  }

  const discovered = {
    instance_id: instance.instance_id,
    module_id: instance.module_id,
    adapter_id: instance.adapter_id,
    native_id: instance.native_id,
    root_path: instance.root_path || '',
    config: instance.config_json,
  }

  if (!claimFactoryApproval(workspaceId, requestId)) {
    return { approval: getFactoryApproval(workspaceId, requestId), processed: false, reason: 'Approval already claimed or changed.' }
  }

  const runId = randomUUID()
  createFactoryCommandRun({
    workspaceId,
    runId,
    instanceId: instance.instance_id,
    commandId,
    arguments: commandArguments,
    risk: commandDefinition.risk,
    requestedBy: approval.decision_by || 'local-owner',
    beforeRevision: approval.expected_revision,
  })

  let result
  try {
    result = await adapter.execute(discovered, executeRequest)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Factory approval execution failed'
    completeFactoryCommandRun({
      workspaceId,
      runId,
      state: 'FAILED',
      error: message,
    })
    const failed = updateFactoryApprovalState({
      workspaceId,
      requestId,
      state: 'FAILED',
      nativeResult: { run_id: runId, error: message },
    })
    return { approval: failed, processed: true, run_id: runId, result: null }
  }

  if (result.snapshot) {
    saveFactorySnapshot(workspaceId, result.snapshot)
    syncOpenApprovalRequests(workspaceId, result.snapshot)
  }

  completeFactoryCommandRun({
    workspaceId,
    runId,
    state: result.state,
    afterRevision: result.after_revision,
    stdoutExcerpt: result.stdout_excerpt,
    stderrExcerpt: result.stderr_excerpt,
    error: result.error,
  })

  recordExperience({
    workspaceId,
    experienceId: `command:${runId}`,
    factoryInstanceId: instance.instance_id,
    stageId: result.snapshot?.lifecycle.process_stage_id || result.snapshot?.lifecycle.native_stage || null,
    actionType: approval.gate_id.startsWith('publish:') ? 'distribution_publish' : 'factory_command',
    workerKind: 'deterministic',
    workerIdentity: instance.adapter_id,
    inputs: [{ command_id: commandId, gate: approval.gate_id, ...(publishEvidence ? { publish_evidence: publishEvidence } : {}) }],
    artifactRefs: [],
    checks: result.snapshot?.checks || [],
    metrics: result.snapshot?.metrics || [],
    outcome: result.state === 'APPLIED' ? 'success' : result.state === 'STALE' ? 'mixed' : 'failure',
    cost: { paid_usd: 0, local_compute: true },
    evidenceRefs: [`approval:${requestId}`, ...(publishEvidence && typeof publishEvidence === 'object' && 'evidence_ref' in publishEvidence ? [String(publishEvidence.evidence_ref)] : [])],
    sourceRevision: result.after_revision || result.before_revision,
  })

  const approvalState = result.state === 'APPLIED'
    ? 'APPLIED'
    : result.state === 'STALE'
      ? 'STALE'
      : 'FAILED'

  const updated = updateFactoryApprovalState({
    workspaceId,
    requestId,
    state: approvalState,
    nativeResult: {
      run_id: runId,
      result_state: result.state,
      before_revision: result.before_revision,
      after_revision: result.after_revision,
      error: result.error,
    },
  })

  return { approval: updated, processed: true, run_id: runId, result }
}

export async function processRecordedFactoryApprovals(workspaceId: number, limit = 5) {
  const pending = listFactoryApprovals(workspaceId, ['DECISION_RECORDED']).slice(0, Math.max(1, Math.min(20, limit)))
  const results = []
  for (const approval of pending) {
    results.push(await processFactoryApproval(workspaceId, approval.request_id))
  }
  return results
}
