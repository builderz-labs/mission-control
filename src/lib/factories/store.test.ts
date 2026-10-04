import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FactorySnapshot } from './types'

let db: Database.Database
vi.mock('@/lib/db', () => ({ getDatabase: () => db }))
import { claimFactoryApproval, getFactoryApproval, recordFactoryApprovalDecision, syncOpenApprovalRequests } from './store'

const instanceId = 'marketing:test'
const gateId = 'content_ready:EP002'
function insert(state = 'OPEN', revision = 'rev1') {
  db.prepare(`INSERT INTO factory_approval_requests
    (workspace_id, request_id, instance_id, gate_id, title, state, expected_revision)
    VALUES (1, 'request1', ?, ?, 'Review EP002', ?, ?)`).run(instanceId, gateId, state, revision)
}
function snapshot(revision: string, gateState: 'open' | 'approved'): FactorySnapshot {
  return {
    snapshot_version: '1.0', instance_id: instanceId, module_id: 'marketing-factory',
    observed_at: new Date().toISOString(),
    source: { authority: 'fixture', native_id: 'test', revision, adapter_version: '1' },
    freshness: { state: 'fresh', last_success_at: new Date().toISOString(), last_error: null },
    lifecycle: { process_stage_id: null, native_stage: null, canonical_phase: 'unknown', status: 'blocked' },
    compatibility: { native_version: '1', contract_coverage: 'partial', warnings: [] },
    gates: [{ id: gateId, state: gateState, blocking: true, evidence_refs: [] }],
    checks: [], artifacts: [], review_queues: [], next_actions: [], blockers: [], risks: [], metrics: [],
    available_commands: [],
  }
}
beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`CREATE TABLE factory_approval_requests (
    id INTEGER PRIMARY KEY, workspace_id INTEGER, request_id TEXT, instance_id TEXT, gate_id TEXT,
    title TEXT, description TEXT, state TEXT, expected_revision TEXT, evidence_refs TEXT,
    decision TEXT, decision_note TEXT, decision_by TEXT, decision_at INTEGER, native_result TEXT,
    created_at INTEGER DEFAULT (unixepoch()), updated_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(workspace_id, request_id)
  )`)
})
afterEach(() => db.close())

describe('Factory approval state safety', () => {
  it.each([['hold', 'HELD'], ['revise', 'REVISION_REQUESTED']] as const)('%s closes the actionable request', (decision, state) => {
    insert()
    const row = recordFactoryApprovalDecision({
      workspaceId: 1, requestId: 'request1', decision, note: 'review first',
      actor: 'owner', expectedRevision: 'rev1',
    })
    expect(row.state).toBe(state)
    expect(() => recordFactoryApprovalDecision({
      workspaceId: 1, requestId: 'request1', decision: 'approve', note: '',
      actor: 'owner', expectedRevision: 'rev1',
    })).toThrow('not open')
  })
  it('rejects a decision against a stale expected revision', () => {
    insert()
    expect(() => recordFactoryApprovalDecision({
      workspaceId: 1, requestId: 'request1', decision: 'approve', note: '',
      actor: 'owner', expectedRevision: 'old',
    })).toThrow('revision changed')
    expect(getFactoryApproval(1, 'request1')?.state).toBe('OPEN')
  })
  it('claims only once, and a refresh cannot mark an applying command as applied', () => {
    insert('DECISION_RECORDED')
    db.prepare("UPDATE factory_approval_requests SET decision = 'approve' WHERE request_id = 'request1'").run()
    expect(claimFactoryApproval(1, 'request1')).toBe(true)
    expect(claimFactoryApproval(1, 'request1')).toBe(false)
    syncOpenApprovalRequests(1, snapshot('rev2', 'approved'))
    expect(getFactoryApproval(1, 'request1')?.state).toBe('APPLYING')
  })
  it('stales an unclaimed decision when native revision changes', () => {
    insert('DECISION_RECORDED')
    syncOpenApprovalRequests(1, snapshot('rev2', 'open'))
    expect(getFactoryApproval(1, 'request1')?.state).toBe('STALE')
  })
  it('does not infer an applied decision from an external native approval', () => {
    insert('DECISION_RECORDED')
    syncOpenApprovalRequests(1, snapshot('rev1', 'approved'))
    expect(getFactoryApproval(1, 'request1')?.state).toBe('STALE')
  })
})
