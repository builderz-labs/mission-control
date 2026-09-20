import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import {
  assertJevProject,
  createJevPolicy,
  deleteJevPolicy,
  listJevEvaluations,
  listJevPolicies,
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
    expect(listJevPolicies(1, 91, db)).toHaveLength(1)
    expect(listJevPolicies(2, 92, db)).toHaveLength(0)
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
})
