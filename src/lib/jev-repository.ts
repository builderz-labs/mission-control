import type Database from 'better-sqlite3'
import { getDatabase } from '@/lib/db'
import type { JevEvaluation, JevPolicy, JevQuestions } from '@/lib/jev-types'
import { jevPolicyConfigurationSchema } from '@/lib/jev-policy-configuration'

export class JevRecordError extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message)
    this.name = 'JevRecordError'
  }
}

type Db = Database.Database

function parseQuestions(value: string): JevQuestions {
  return JSON.parse(value) as JevQuestions
}

function parseConfiguration(value: unknown): JevPolicy['configuration'] {
  if (!value) return null
  try {
    const parsed = jevPolicyConfigurationSchema.safeParse(JSON.parse(String(value)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function policyFromRow(row: Record<string, unknown>): JevPolicy {
  return {
    ...(row as unknown as Omit<JevPolicy, 'questions' | 'configuration' | 'enabled'>),
    questions: parseQuestions(String(row.questions)),
    configuration: parseConfiguration(row.configuration),
    enabled: Boolean(row.enabled),
  }
}

function evaluationFromRow(row: Record<string, unknown>): JevEvaluation {
  return {
    ...(row as unknown as Omit<JevEvaluation, 'questions' | 'answers'>),
    questions: parseQuestions(String(row.questions)),
    answers: row.answers ? JSON.parse(String(row.answers)) as Record<string, unknown> : null,
  }
}

export function assertJevProject(
  workspaceId: number,
  tenantId: number,
  projectId: number,
  db: Db = getDatabase(),
): void {
  const row = db.prepare(`
    SELECT p.id FROM projects p JOIN workspaces w ON w.id = p.workspace_id
    WHERE p.id = ? AND p.workspace_id = ? AND w.tenant_id = ? LIMIT 1
  `).get(projectId, workspaceId, tenantId)
  if (!row) throw new JevRecordError('Project not found', 404)
}

export function listJevPolicies(workspaceId: number, projectId: number, db: Db = getDatabase()): JevPolicy[] {
  const rows = db.prepare(`
    SELECT * FROM jev_policies WHERE workspace_id = ? AND project_id = ?
    ORDER BY updated_at DESC, id DESC
  `).all(workspaceId, projectId) as Record<string, unknown>[]
  return rows.map(policyFromRow)
}

export function getJevPolicy(
  workspaceId: number,
  projectId: number,
  policyId: number,
  db: Db = getDatabase(),
): JevPolicy {
  const row = db.prepare(`
    SELECT * FROM jev_policies WHERE id = ? AND workspace_id = ? AND project_id = ? LIMIT 1
  `).get(policyId, workspaceId, projectId) as Record<string, unknown> | undefined
  if (!row) throw new JevRecordError('Jev policy not found', 404)
  return policyFromRow(row)
}

export function createJevPolicy(
  input: Omit<JevPolicy, 'id' | 'workspace_id' | 'created_at' | 'updated_at'>,
  workspaceId: number,
  db: Db = getDatabase(),
): JevPolicy {
  try {
    const result = db.prepare(`
      INSERT INTO jev_policies
        (workspace_id, project_id, name, description, model, mode, questions, configuration, enabled, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(workspaceId, input.project_id, input.name, input.description, input.model,
      input.mode, JSON.stringify(input.questions), input.configuration ? JSON.stringify(input.configuration) : null,
      input.enabled ? 1 : 0, input.created_by)
    return getJevPolicy(workspaceId, input.project_id, Number(result.lastInsertRowid), db)
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      throw new JevRecordError('A policy with this name already exists for the project', 409)
    }
    throw error
  }
}

export function updateJevPolicy(
  policy: JevPolicy,
  updates: Partial<Pick<JevPolicy, 'name' | 'description' | 'model' | 'mode' | 'questions' | 'configuration' | 'enabled'>>,
  db: Db = getDatabase(),
): JevPolicy {
  const next = { ...policy, ...updates }
  try {
    db.prepare(`
      UPDATE jev_policies SET name=?, description=?, model=?, mode=?, questions=?, configuration=?, enabled=?, updated_at=unixepoch()
      WHERE id=? AND workspace_id=? AND project_id=?
    `).run(next.name, next.description, next.model, next.mode, JSON.stringify(next.questions),
      next.configuration ? JSON.stringify(next.configuration) : null, next.enabled ? 1 : 0,
      policy.id, policy.workspace_id, policy.project_id)
    return getJevPolicy(policy.workspace_id, policy.project_id, policy.id, db)
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      throw new JevRecordError('A policy with this name already exists for the project', 409)
    }
    throw error
  }
}

export function deleteJevPolicy(policy: JevPolicy, db: Db = getDatabase()): void {
  db.prepare('DELETE FROM jev_policies WHERE id=? AND workspace_id=? AND project_id=?')
    .run(policy.id, policy.workspace_id, policy.project_id)
}

export function listJevEvaluations(
  workspaceId: number,
  projectId: number,
  limit = 50,
  db: Db = getDatabase(),
): JevEvaluation[] {
  const rows = db.prepare(`
    SELECT e.*, p.name AS project_name, COALESCE(e.policy_name_snapshot,jp.name) AS policy_name
    FROM jev_evaluations e JOIN projects p ON p.id=e.project_id
    LEFT JOIN jev_policies jp ON jp.id=e.policy_id
    WHERE e.workspace_id=? AND e.project_id=? ORDER BY e.created_at DESC LIMIT ?
  `).all(workspaceId, projectId, limit) as Record<string, unknown>[]
  return rows.map(evaluationFromRow)
}

export function getJevEvaluationByIdempotency(
  workspaceId: number,
  idempotencyKey: string,
  db: Db = getDatabase(),
): JevEvaluation | null {
  const row = db.prepare(`
    SELECT e.*, p.name AS project_name, COALESCE(e.policy_name_snapshot,jp.name) AS policy_name
    FROM jev_evaluations e JOIN projects p ON p.id=e.project_id
    LEFT JOIN jev_policies jp ON jp.id=e.policy_id
    WHERE e.workspace_id=? AND e.idempotency_key=? LIMIT 1
  `).get(workspaceId, idempotencyKey) as Record<string, unknown> | undefined
  return row ? evaluationFromRow(row) : null
}

export function insertJevEvaluation(row: Record<string, unknown>, db: Db = getDatabase()): void {
  db.prepare(`
    INSERT INTO jev_evaluations
      (id,workspace_id,project_id,policy_id,status,model_requested,questions,state_sha256,
       state_length,state_preview,created_by,idempotency_key,policy_name_snapshot,
       policy_configuration_snapshot)
    VALUES (@id,@workspace_id,@project_id,@policy_id,'running',@model_requested,@questions,
      @state_sha256,@state_length,@state_preview,@created_by,@idempotency_key,
      @policy_name_snapshot,@policy_configuration_snapshot)
  `).run(row)
}

export function finishJevEvaluation(
  id: string,
  workspaceId: number,
  values: Record<string, unknown>,
  db: Db = getDatabase(),
): void {
  const result = db.prepare(`
    UPDATE jev_evaluations SET status=@status, model_resolved=@model_resolved, answers=@answers,
      usage_input_tokens=@usage_input_tokens, usage_output_tokens=@usage_output_tokens,
      latency_ms=@latency_ms, request_id=@request_id, error_code=@error_code, completed_at=unixepoch()
    WHERE id=@id AND workspace_id=@workspace_id
  `).run({ id, workspace_id: workspaceId, ...values })
  if (result.changes !== 1) throw new JevRecordError('Jev evaluation not found', 404)
}

export function reconcileStaleJevEvaluations(
  workspaceId: number,
  maximumAgeSeconds = 300,
  db: Db = getDatabase(),
): number {
  return db.prepare(`
    UPDATE jev_evaluations SET status='failed',error_code='JEV_INTERRUPTED',completed_at=unixepoch()
    WHERE workspace_id=? AND status='running' AND created_at < unixepoch()-?
  `).run(workspaceId, maximumAgeSeconds).changes
}
