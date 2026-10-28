import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let db: Database.Database
vi.mock('@/lib/db', () => ({ getDatabase: () => db }))
import {
  createImprovementCandidate,
  deterministicCandidateSignals,
  deterministicLearningAggregates,
  listLearningEvidence,
  recordExperience,
  recordImprovementEvaluation,
  proposeReadyImprovementCandidate,
  recordLearningEvidence,
  transitionImprovementCandidate,
} from './learning-store'

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE experience_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      experience_id TEXT NOT NULL,
      project_id TEXT,
      factory_instance_id TEXT,
      stage_id TEXT,
      action_type TEXT NOT NULL,
      worker_kind TEXT,
      worker_identity TEXT,
      inputs TEXT NOT NULL DEFAULT '[]',
      artifact_refs TEXT NOT NULL DEFAULT '[]',
      checks TEXT NOT NULL DEFAULT '[]',
      metrics TEXT NOT NULL DEFAULT '[]',
      outcome TEXT,
      cost TEXT NOT NULL DEFAULT '{}',
      evidence_refs TEXT NOT NULL DEFAULT '[]',
      source_revision TEXT,
      observed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(workspace_id, experience_id)
    );

    CREATE TABLE learning_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      evidence_id TEXT NOT NULL,
      evidence_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      candidate_id TEXT,
      skill_ref TEXT,
      result TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      observed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(workspace_id, evidence_id)
    );

    CREATE TABLE improvement_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      candidate_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      target TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROPOSED',
      hypothesis TEXT NOT NULL DEFAULT '',
      evidence_refs TEXT NOT NULL DEFAULT '[]',
      sample_size INTEGER NOT NULL DEFAULT 0,
      confidence_label TEXT,
      expected_effect TEXT NOT NULL DEFAULT '{}',
      eval_plan TEXT NOT NULL DEFAULT '{}',
      review_policy TEXT,
      promotion_state TEXT NOT NULL DEFAULT 'UNTESTED',
      change_ref TEXT,
      rollback_target TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)
})

afterEach(() => db.close())

describe('deterministic learning aggregation', () => {
  it('deduplicates a source revision and isolates workspaces', () => {
    recordExperience({ workspaceId: 1, experienceId: 'snapshot:one:r1', factoryInstanceId: 'one', actionType: 'factory_snapshot', outcome: 'mixed', observedAt: 1001 })
    recordExperience({ workspaceId: 1, experienceId: 'snapshot:one:r1', factoryInstanceId: 'one', actionType: 'factory_snapshot', outcome: 'mixed', observedAt: 1002 })
    recordExperience({ workspaceId: 2, experienceId: 'snapshot:one:r1', factoryInstanceId: 'one', actionType: 'factory_snapshot', outcome: 'success', observedAt: 1003 })
    expect(deterministicLearningAggregates(1).factory_rollups[0]).toMatchObject({ events: 1, mixed: 1, success: 0, reflection_eligible: false, evidence_needed: 4 })
    expect(deterministicLearningAggregates(2).factory_rollups[0]).toMatchObject({ events: 1, success: 1 })
  })
  it('marks reflection eligibility only after the evidence threshold and counts recurring failed checks', () => {
    for (let i = 1; i <= 5; i += 1) {
      recordExperience({
        workspaceId: 1,
        experienceId: 'e' + i,
        factoryInstanceId: 'marketing:shufuro',
        actionType: 'factory_snapshot',
        outcome: i === 1 ? 'mixed' : 'success',
        checks: [{ id: 'hook_density', ok: i > 2 }],
        observedAt: 1000 + i,
      })
    }

    const analysis = deterministicLearningAggregates(1)
    expect(analysis.factory_rollups).toHaveLength(1)
    expect(analysis.factory_rollups[0]).toMatchObject({
      factory_instance_id: 'marketing:shufuro',
      events: 5,
      success: 4,
      mixed: 1,
      reflection_eligible: true,
      evidence_needed: 0,
    })
    expect(analysis.recurring_check_failures[0]).toMatchObject({
      check_id: 'hook_density',
      count: 2,
      recurring: true,
    })
  })
})

describe('typed learning evidence', () => {
  it('stores typed evidence with workspace isolation', () => {
    recordLearningEvidence({
      workspaceId: 1,
      evidenceId: 'typed-1',
      evidenceType: 'verified_build',
      sourceType: 'build',
      sourceRef: 'build:123',
      result: 'positive',
      subjectKey: 'product:release-readiness',
      observedAt: 2001,
    })
    recordLearningEvidence({
      workspaceId: 2,
      evidenceId: 'typed-1',
      evidenceType: 'human_confirmation',
      sourceType: 'human',
      sourceRef: 'decision:1',
      result: 'positive',
      subjectKey: 'product:release-readiness',
      observedAt: 2002,
    })

    expect(listLearningEvidence(1)).toHaveLength(1)
    expect(listLearningEvidence(1)[0]).toMatchObject({
      evidence_id: 'typed-1',
      evidence_type: 'verified_build',
      source_ref: 'build:123',
      result: 'positive',
    })
    expect(listLearningEvidence(2)[0].evidence_type).toBe('human_confirmation')
  })

  it('reports remaining evidence against all candidate readiness conditions', () => {
    for (let i = 1; i <= 5; i += 1) {
      recordLearningEvidence({
        workspaceId: 1,
        evidenceId: `positive-${i}`,
        evidenceType: 'real_metric',
        sourceType: 'metric',
        sourceRef: 'source:single',
        result: 'positive',
        subjectKey: 'marketing:shufuro:weak-signal',
        observedAt: 2500 + i,
      })
    }

    expect(deterministicCandidateSignals(1)[0]).toMatchObject({
      subject_key: 'marketing:shufuro:weak-signal',
      evidence_count: 5,
      negative: 0,
      mixed: 0,
      unique_sources: 1,
      candidate_ready: false,
      evidence_needed: 2,
    })
  })

  it('marks a deterministic candidate signal ready only after sufficient multi-source problem evidence', () => {
    const rows = [
      ['e1', 'source:a', 'negative'],
      ['e2', 'source:a', 'positive'],
      ['e3', 'source:b', 'mixed'],
      ['e4', 'source:b', 'positive'],
      ['e5', 'source:c', 'positive'],
    ] as const

    rows.forEach(([evidenceId, sourceRef, result], index) => {
      recordLearningEvidence({
        workspaceId: 1,
        evidenceId,
        evidenceType: index % 2 === 0 ? 'real_metric' : 'deterministic_test',
        sourceType: 'test',
        sourceRef,
        result,
        subjectKey: 'marketing:shufuro:hook-density',
        observedAt: 3000 + index,
      })
    })

    expect(deterministicCandidateSignals(1)[0]).toMatchObject({
      subject_key: 'marketing:shufuro:hook-density',
      evidence_count: 5,
      negative: 1,
      mixed: 1,
      unique_sources: 3,
      candidate_ready: true,
      evidence_needed: 0,
    })

    db.prepare(`
      INSERT INTO improvement_candidates (
        workspace_id, candidate_id, scope, target, hypothesis
      ) VALUES (1, 'candidate-1', 'check', 'marketing:shufuro:hook-density', 'test')
    `).run()

    expect(deterministicCandidateSignals(1)[0]).toMatchObject({
      has_active_candidate: true,
      candidate_ready: false,
    })
  })
})


describe('improvement candidate lifecycle', () => {
  const evalPlan = { metric: 'hook_density', baseline: 10, direction: 'decrease' as const, minimum_effect: 1, method: 'deterministic fixture' }

  function seedEvidence() {
    return Array.from({ length: 5 }, (_, index) => recordLearningEvidence({
      workspaceId: 1,
      evidenceId: `seed-${index}`,
      evidenceType: 'deterministic_check',
      sourceType: 'snapshot',
      sourceRef: `revision-${index}`,
      result: index < 2 ? 'negative' : 'positive',
      subjectKey: 'marketing:shufuro:hook-density',
    }))
  }

  it('rejects invalid or stale transitions', () => {
    const candidate = createImprovementCandidate({
      workspaceId: 1,
      scope: 'check',
      target: 'marketing:shufuro:hook-density',
      hypothesis: 'Reduce repeated hook-density failures',
      evidenceRefs: seedEvidence(),
      sampleSize: 5,
      evalPlan,
    })

    expect(() => transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'PROPOSED',
      toStatus: 'PROMOTED',
      actor: 'owner',
      reason: 'skip ahead',
      changeRef: 'change:1',
      rollbackTarget: 'rollback:1',
    })).toThrow(/transition/i)

    transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'PROPOSED',
      toStatus: 'EVAL_READY',
      actor: 'owner',
      reason: 'eval plan is ready',
    })

    expect(() => transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'PROPOSED',
      toStatus: 'EVALUATING',
      actor: 'owner',
      reason: 'stale client',
    })).toThrow(/changed before transition/i)
  })

  it('requires evaluation evidence and rollback metadata before promotion', () => {
    const candidate = createImprovementCandidate({
      workspaceId: 1,
      scope: 'check',
      target: 'marketing:shufuro:hook-density',
      hypothesis: 'Reduce repeated hook-density failures',
      evidenceRefs: seedEvidence(),
      sampleSize: 5,
      confidenceLabel: 'medium',
      evalPlan,
      reviewPolicy: 'human',
    })

    const ready = transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'PROPOSED',
      toStatus: 'EVAL_READY',
      actor: 'owner',
      reason: 'evaluation plan accepted',
    })
    expect(ready).toMatchObject({ status: 'EVAL_READY', promotion_state: 'UNTESTED' })

    const evaluating = transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'EVAL_READY',
      toStatus: 'EVALUATING',
      actor: 'owner',
      reason: 'start deterministic eval',
    })
    expect(evaluating).toMatchObject({ status: 'EVALUATING', promotion_state: 'EVALUATING' })

    expect(() => transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'EVALUATING',
      toStatus: 'REVIEW_REQUIRED',
      actor: 'owner',
      reason: 'eval completed',
    })).toThrow(/evaluation evidence/i)

    const evaluation = recordImprovementEvaluation({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      after: 8,
      sourceRef: 'vitest:eval-pass',
      actor: 'owner',
    })
    expect(evaluation).toMatchObject({ passed: true, effect: 2 })

    const reviewed = transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'EVALUATING',
      toStatus: 'REVIEW_REQUIRED',
      actor: 'owner',
      reason: 'eval passed',
      evidenceRefs: [evaluation.evidenceId],
    })
    expect(reviewed).toMatchObject({ status: 'REVIEW_REQUIRED', promotion_state: 'EVAL_PASSED' })
    expect(listLearningEvidence(1).find((row) => row.evidence_id === evaluation.evidenceId)?.candidate_id).toBe(candidate.candidate_id)

    const approval = transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'REVIEW_REQUIRED',
      toStatus: 'APPROVAL_REQUIRED',
      actor: 'reviewer',
      reason: 'review accepted',
    })
    expect(approval.status).toBe('APPROVAL_REQUIRED')

    expect(() => transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'APPROVAL_REQUIRED',
      toStatus: 'PROMOTED',
      actor: 'admin',
      reason: 'approve',
      changeRef: 'change:hook-density-v2',
    })).toThrow(/rollback target/i)

    const promoted = transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'APPROVAL_REQUIRED',
      toStatus: 'PROMOTED',
      actor: 'admin',
      reason: 'approved after eval',
      changeRef: 'change:hook-density-v2',
      rollbackTarget: 'change:hook-density-v1',
    })
    expect(promoted).toMatchObject({
      status: 'PROMOTED',
      promotion_state: 'PROMOTED',
      change_ref: 'change:hook-density-v2',
      rollback_target: 'change:hook-density-v1',
    })
  })

  it('records an auditable rollback from observation', () => {
    recordLearningEvidence({
      workspaceId: 1,
      evidenceId: 'rollback-signal',
      evidenceType: 'real_metric',
      sourceType: 'metric',
      sourceRef: 'metric:after-promotion',
      result: 'negative',
      subjectKey: 'marketing:shufuro:hook-density',
      observedAt: 5001,
    })

    const candidate = createImprovementCandidate({
      workspaceId: 1,
      scope: 'check',
      target: 'marketing:shufuro:hook-density',
      hypothesis: 'Reduce repeated hook-density failures',
      evidenceRefs: seedEvidence(),
      sampleSize: 5,
      evalPlan,
      rollbackTarget: 'change:hook-density-v1',
    })

    for (const [from, to] of [
      ['PROPOSED', 'EVAL_READY'],
      ['EVAL_READY', 'EVALUATING'],
    ] as const) {
      transitionImprovementCandidate({
        workspaceId: 1,
        candidateId: candidate.candidate_id,
        expectedStatus: from,
        toStatus: to,
        actor: 'owner',
        reason: 'advance',
      })
    }

    const evaluation = recordImprovementEvaluation({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      after: 8,
      sourceRef: 'vitest:rollback-eval',
      actor: 'owner',
    })
    transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'EVALUATING',
      toStatus: 'REVIEW_REQUIRED',
      actor: 'owner',
      reason: 'eval passed',
      evidenceRefs: [evaluation.evidenceId],
    })
    transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'REVIEW_REQUIRED',
      toStatus: 'APPROVAL_REQUIRED',
      actor: 'reviewer',
      reason: 'review accepted',
    })
    transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'APPROVAL_REQUIRED',
      toStatus: 'PROMOTED',
      actor: 'admin',
      reason: 'promote',
      changeRef: 'change:hook-density-v2',
    })
    transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'PROMOTED',
      toStatus: 'OBSERVING',
      actor: 'owner',
      reason: 'observe real outcomes',
    })

    expect(() => transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'OBSERVING',
      toStatus: 'ROLLED_BACK',
      actor: 'admin',
      reason: '',
    })).toThrow(/reason/i)

    const rolledBack = transitionImprovementCandidate({
      workspaceId: 1,
      candidateId: candidate.candidate_id,
      expectedStatus: 'OBSERVING',
      toStatus: 'ROLLED_BACK',
      actor: 'admin',
      reason: 'real metric regressed',
      evidenceRefs: ['rollback-signal'],
    })
    expect(rolledBack).toMatchObject({ status: 'ROLLED_BACK', promotion_state: 'ROLLED_BACK' })

    const auditRows = db.prepare(`
      SELECT action_type, worker_kind, worker_identity, inputs
      FROM experience_events
      WHERE workspace_id = 1 AND action_type = 'improvement_candidate_transition'
      ORDER BY id
    `).all() as Array<{ action_type: string; worker_kind: string; worker_identity: string; inputs: string }>
    expect(auditRows.length).toBeGreaterThanOrEqual(6)
    expect(auditRows.at(-1)).toMatchObject({ worker_kind: 'human', worker_identity: 'admin' })
    expect(JSON.parse(auditRows.at(-1)!.inputs)[0]).toMatchObject({
      candidate_id: candidate.candidate_id,
      from_status: 'OBSERVING',
      to_status: 'ROLLED_BACK',
      reason: 'real metric regressed',
    })
  })

  it('proposes only when real typed evidence meets the deterministic threshold', () => {
    const input = {
      workspaceId: 1,
      scope: 'check' as const,
      target: 'marketing:shufuro:hook-density',
      hypothesis: 'Reduce repeated hook-density failures',
      evalPlan,
    }
    expect(() => proposeReadyImprovementCandidate(input)).toThrow(/threshold/i)
    seedEvidence()
    const candidate = proposeReadyImprovementCandidate(input)
    expect(candidate.sample_size).toBe(5)
    expect(JSON.parse(candidate.evidence_refs)).toHaveLength(5)
    expect(() => proposeReadyImprovementCandidate(input)).toThrow(/threshold/i)
  })

  it('holds failed evaluations and requires an independent reviewer for high-risk scope', () => {
    const candidate = createImprovementCandidate({
      workspaceId: 1,
      scope: 'workflow',
      target: 'marketing:shufuro:hook-density',
      hypothesis: 'Improve workflow checks',
      evidenceRefs: seedEvidence(),
      sampleSize: 5,
      evalPlan,
    })
    expect(candidate.review_policy).toBe('independent_and_human')
    for (const [from, to] of [['PROPOSED', 'EVAL_READY'], ['EVAL_READY', 'EVALUATING']] as const) {
      transitionImprovementCandidate({ workspaceId: 1, candidateId: candidate.candidate_id, expectedStatus: from, toStatus: to, actor: 'builder', reason: 'advance' })
    }
    const failed = recordImprovementEvaluation({ workspaceId: 1, candidateId: candidate.candidate_id, after: 10, sourceRef: 'fixture:failed', actor: 'builder' })
    expect(failed.passed).toBe(false)
    expect(() => transitionImprovementCandidate({ workspaceId: 1, candidateId: candidate.candidate_id, expectedStatus: 'EVALUATING', toStatus: 'REVIEW_REQUIRED', actor: 'builder', evidenceRefs: [failed.evidenceId] })).toThrow(/Passing evaluation evidence/)
    const passed = recordImprovementEvaluation({ workspaceId: 1, candidateId: candidate.candidate_id, after: 8, sourceRef: 'fixture:passed', actor: 'builder' })
    transitionImprovementCandidate({ workspaceId: 1, candidateId: candidate.candidate_id, expectedStatus: 'EVALUATING', toStatus: 'REVIEW_REQUIRED', actor: 'builder', evidenceRefs: [passed.evidenceId] })
    expect(() => transitionImprovementCandidate({ workspaceId: 1, candidateId: candidate.candidate_id, expectedStatus: 'REVIEW_REQUIRED', toStatus: 'APPROVAL_REQUIRED', actor: 'builder', reason: 'self-review' })).toThrow(/independent review/i)
    expect(transitionImprovementCandidate({ workspaceId: 1, candidateId: candidate.candidate_id, expectedStatus: 'REVIEW_REQUIRED', toStatus: 'APPROVAL_REQUIRED', actor: 'reviewer', reason: 'independent review' }).status).toBe('APPROVAL_REQUIRED')
  })
})
