// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '@/lib/migrations'
import { createJevPolicy } from '@/lib/jev-repository'
import { JevClientError } from '@/lib/jev-client'
import { runJevEvaluation } from '@/lib/jev-service'

const mocks = vi.hoisted(() => ({ evaluate: vi.fn(), audit: vi.fn() }))
let db: InstanceType<typeof Database>

vi.mock('@/lib/db', () => ({ getDatabase: () => db, logAuditEvent: mocks.audit }))
vi.mock('@/lib/jev-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jev-client')>()
  return { ...actual, evaluateWithJev: mocks.evaluate }
})

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  db.prepare("INSERT INTO projects (id,workspace_id,name,slug,ticket_prefix) VALUES (71,1,'Repo','repo','REP')").run()
  mocks.evaluate.mockReset()
  mocks.audit.mockReset()
})

afterEach(() => db.close())

function policyId(): number {
  return createJevPolicy({
    project_id: 71, name: 'Gate', description: null, model: 'jev-latest', mode: 'shadow',
    questions: { ready: { type: 'noul', instructions: 'Is this ready?' } },
    enabled: true, created_by: 'operator',
  }, 1, db).id
}

const actor = { id: 4, username: 'operator' }

describe('Jev evaluation lifecycle', () => {
  it('stores provenance without retaining raw state by default', async () => {
    mocks.evaluate.mockResolvedValue({
      model: 'jev-1.13.0', answers: { ready: { type: 'noul', noul: 0.8 } },
      usage: { input_tokens: 20, output_tokens: 4 }, requestId: 'req_safe',
    })
    const result = await runJevEvaluation({
      workspaceId: 1, projectId: 71, policyId: policyId(), state: 'private repository state',
      retainStatePreview: false, actor,
    })
    const row = db.prepare('SELECT * FROM jev_evaluations WHERE id=?').get(result.id) as Record<string, unknown>
    expect(row).toMatchObject({ status: 'succeeded', model_resolved: 'jev-1.13.0', state_preview: null })
    expect(row.state_sha256).not.toBe('private repository state')
    expect(JSON.stringify(row)).not.toContain('private repository state')
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'jev_evaluation_succeeded' }))
  })

  it('retains only a bounded preview after explicit opt-in', async () => {
    mocks.evaluate.mockResolvedValue({
      model: 'jev-1.13.0', answers: {}, usage: { input_tokens: 1, output_tokens: 1 }, requestId: null,
    })
    const result = await runJevEvaluation({
      workspaceId: 1, projectId: 71, policyId: policyId(), state: 'x'.repeat(800),
      retainStatePreview: true, actor,
    })
    const row = db.prepare('SELECT state_preview FROM jev_evaluations WHERE id=?').get(result.id) as { state_preview: string }
    expect(row.state_preview).toHaveLength(500)
  })

  it('persists only a safe code when the provider fails', async () => {
    mocks.evaluate.mockRejectedValue(new JevClientError('JEV_RATE_LIMITED', 429, 'req_fail'))
    await expect(runJevEvaluation({
      workspaceId: 1, projectId: 71, policyId: policyId(), state: 'state',
      retainStatePreview: false, actor,
    })).rejects.toMatchObject({ code: 'JEV_RATE_LIMITED' })
    const row = db.prepare('SELECT status,error_code,answers,request_id FROM jev_evaluations ORDER BY created_at DESC LIMIT 1').get()
    expect(row).toEqual({ status: 'failed', error_code: 'JEV_RATE_LIMITED', answers: null, request_id: 'req_fail' })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'jev_evaluation_failed' }))
  })

  it('refuses disabled policies before calling the provider', async () => {
    const id = policyId()
    db.prepare('UPDATE jev_policies SET enabled=0 WHERE id=?').run(id)
    await expect(runJevEvaluation({
      workspaceId: 1, projectId: 71, policyId: id, state: 'state',
      retainStatePreview: false, actor,
    })).rejects.toMatchObject({ code: 'JEV_POLICY_DISABLED', status: 409 })
    expect(mocks.evaluate).not.toHaveBeenCalled()
  })
})
