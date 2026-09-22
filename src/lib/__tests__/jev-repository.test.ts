import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import {
  assertJevProject,
  createJevPolicy,
  deleteJevPolicy,
  listJevEvaluations,
  listJevPolicies,
  reconcileStaleJevEvaluations,
} from '@/lib/jev-repository'

let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  db.prepare("INSERT INTO tenants (id,slug,display_name,linux_user,openclaw_home,workspace_root) VALUES (2,'two','Two','two','/tmp/two','/tmp/two')").run()
  db.prepare("INSERT INTO workspaces (id,slug,name,tenant_id) VALUES (2,'two','Two',2)").run()
  db.prepare("INSERT INTO projects (id,workspace_id,name,slug,ticket_prefix) VALUES (91,1,'One','one','ONE')").run()
  db.prepare("INSERT INTO projects (id,workspace_id,name,slug,ticket_prefix) VALUES (92,2,'Two','two','TWO')").run()
})

afterEach(() => db.close())

function createPolicy() {
  return createJevPolicy({
    project_id: 91, name: 'Safety', description: null, model: 'jev-latest', mode: 'shadow',
    questions: { safe: { type: 'noul', instructions: 'Is this safe?' } },
    configuration: {
      scope: 'current', projectIds: [91], trigger: 'manual', enforcement: 'advisory',
      contextMode: 'safe_repository', failureMode: 'retry_then_review', rollout: 'shadow',
      retainPreview: false, uncertaintyThreshold: 0.65,
      tests: ['Contract'], risks: ['Incomplete evidence'], observability: ['Latency'],
    },
    enabled: true, created_by: 'operator',
  }, 1, db)
}

describe('Jev repository isolation', () => {
  it('requires project, workspace, and tenant ownership together', () => {
    expect(() => assertJevProject(1, 1, 91, db)).not.toThrow()
    expect(() => assertJevProject(1, 2, 91, db)).toThrow('Project not found')
    expect(() => assertJevProject(1, 1, 92, db)).toThrow('Project not found')
  })

  it('round-trips policy questions without leaking across projects', () => {
    const policy = createPolicy()
    expect(policy.questions.safe.type).toBe('noul')
    expect(policy.configuration?.trigger).toBe('manual')
    expect(listJevPolicies(1, 91, db)).toHaveLength(1)
    expect(listJevPolicies(2, 92, db)).toHaveLength(0)
  })

  it('fails closed without crashing on malformed persisted configuration', () => {
    const policy = createPolicy()
    db.prepare('UPDATE jev_policies SET configuration=? WHERE id=?').run('{not-json', policy.id)
    expect(listJevPolicies(1, 91, db)[0].configuration).toBeNull()
    db.prepare('UPDATE jev_policies SET configuration=? WHERE id=?')
      .run(JSON.stringify({ projectIds: [92] }), policy.id)
    expect(listJevPolicies(1, 91, db)[0].configuration).toBeNull()
  })

  it('keeps evaluation history when a policy is deleted', () => {
    const policy = createPolicy()
    db.prepare(`INSERT INTO jev_evaluations
      (id,workspace_id,project_id,policy_id,status,model_requested,questions,state_sha256,state_length,created_by)
      VALUES ('eval',1,91,?,'succeeded','jev-latest','{}','hash',4,'operator')`).run(policy.id)
    deleteJevPolicy(policy, db)
    const rows = listJevEvaluations(1, 91, 10, db)
    expect(rows).toHaveLength(1)
    expect(rows[0].policy_id).toBeNull()
  })

  it('preserves the policy name captured when an evaluation ran', () => {
    const policy = createPolicy()
    db.prepare(`INSERT INTO jev_evaluations
      (id,workspace_id,project_id,policy_id,status,model_requested,questions,state_sha256,
       state_length,created_by,policy_name_snapshot)
      VALUES ('snapshot',1,91,?,'succeeded','jev-latest','{}','hash',4,'operator','Safety')`)
      .run(policy.id)
    db.prepare("UPDATE jev_policies SET name='Renamed' WHERE id=?").run(policy.id)
    expect(listJevEvaluations(1, 91, 10, db)[0].policy_name).toBe('Safety')
  })

  it('fails stale running evaluations closed after an interrupted process', () => {
    db.prepare(`INSERT INTO jev_evaluations
      (id,workspace_id,project_id,status,model_requested,questions,state_sha256,state_length,created_by,created_at)
      VALUES ('stale',1,91,'running','jev-latest','{}','hash',4,'operator',unixepoch()-600)`)
      .run()
    expect(reconcileStaleJevEvaluations(1, 300, db)).toBe(1)
    expect(db.prepare('SELECT status,error_code FROM jev_evaluations WHERE id=?').get('stale'))
      .toEqual({ status: 'failed', error_code: 'JEV_INTERRUPTED' })
  })
})
