import { randomUUID } from 'node:crypto'
import { getDatabase } from '@/lib/db'
import type { FactorySnapshot } from './types'

export interface ExperienceEventRow {
  id: number
  workspace_id: number
  experience_id: string
  project_id: string | null
  factory_instance_id: string | null
  stage_id: string | null
  action_type: string
  worker_kind: string | null
  worker_identity: string | null
  inputs: string
  artifact_refs: string
  checks: string
  metrics: string
  outcome: string | null
  cost: string
  evidence_refs: string
  source_revision: string | null
  observed_at: number
  created_at: number
}

export interface ImprovementCandidateRow {
  id: number
  workspace_id: number
  candidate_id: string
  scope: string
  target: string
  status: string
  hypothesis: string
  evidence_refs: string
  sample_size: number
  confidence_label: string | null
  expected_effect: string
  eval_plan: string
  review_policy: string | null
  promotion_state: string
  change_ref: string | null
  rollback_target: string | null
  created_at: number
  updated_at: number
}

export interface CandidateEvalPlan {
  metric: string
  baseline: number
  direction: 'increase' | 'decrease'
  minimum_effect: number
  method: string
}

const HIGH_RISK_SCOPES = new Set(['workflow', 'policy', 'business_rule', 'security', 'release', 'permission'])

function parseEvalPlan(value: string): CandidateEvalPlan | null {
  try {
    const plan = JSON.parse(value) as CandidateEvalPlan
    if (!plan || typeof plan.metric !== 'string' || !plan.metric.trim()
      || typeof plan.method !== 'string' || !plan.method.trim()
      || !Number.isFinite(plan.baseline) || !Number.isFinite(plan.minimum_effect)
      || plan.minimum_effect < 0 || !['increase', 'decrease'].includes(plan.direction)) return null
    return plan
  } catch {
    return null
  }
}

export const IMPROVEMENT_CANDIDATE_STATUSES = [
  'PROPOSED',
  'EVAL_READY',
  'EVALUATING',
  'REVIEW_REQUIRED',
  'APPROVAL_REQUIRED',
  'PROMOTED',
  'REJECTED',
  'HELD',
  'OBSERVING',
  'REINFORCED',
  'ROLLED_BACK',
  'DECAYING',
  'ARCHIVED',
] as const

export type ImprovementCandidateStatus = typeof IMPROVEMENT_CANDIDATE_STATUSES[number]

const IMPROVEMENT_CANDIDATE_TRANSITIONS: Record<ImprovementCandidateStatus, readonly ImprovementCandidateStatus[]> = {
  PROPOSED: ['EVAL_READY', 'REJECTED', 'HELD'],
  EVAL_READY: ['EVALUATING', 'REJECTED', 'HELD'],
  EVALUATING: ['REVIEW_REQUIRED', 'REJECTED', 'HELD'],
  REVIEW_REQUIRED: ['APPROVAL_REQUIRED', 'REJECTED', 'HELD'],
  APPROVAL_REQUIRED: ['PROMOTED', 'REJECTED', 'HELD'],
  PROMOTED: ['OBSERVING', 'ROLLED_BACK'],
  REJECTED: ['ARCHIVED'],
  HELD: ['EVAL_READY', 'REJECTED', 'ARCHIVED'],
  OBSERVING: ['REINFORCED', 'ROLLED_BACK', 'DECAYING'],
  REINFORCED: ['OBSERVING', 'ROLLED_BACK', 'DECAYING'],
  ROLLED_BACK: ['ARCHIVED'],
  DECAYING: ['OBSERVING', 'ROLLED_BACK', 'ARCHIVED'],
  ARCHIVED: [],
}

export const LEARNING_EVIDENCE_TYPES = [
  'deterministic_check',
  'deterministic_test',
  'accepted_code_diff',
  'verified_build',
  'verified_publish',
  'verified_postcondition',
  'real_metric',
  'conversion_revenue',
  'independent_review',
  'human_confirmation',
] as const

export type LearningEvidenceType = typeof LEARNING_EVIDENCE_TYPES[number]
export type LearningEvidenceResult = 'positive' | 'negative' | 'mixed' | 'informational'

export interface LearningEvidenceRow {
  id: number
  workspace_id: number
  evidence_id: string
  evidence_type: LearningEvidenceType
  source_type: string
  source_ref: string
  candidate_id: string | null
  skill_ref: string | null
  result: LearningEvidenceResult | null
  payload: string
  observed_at: number
  created_at: number
}

export function recordExperience(input: {
  workspaceId: number
  experienceId?: string
  projectId?: string | null
  factoryInstanceId?: string | null
  stageId?: string | null
  actionType: string
  workerKind?: string | null
  workerIdentity?: string | null
  inputs?: unknown[]
  artifactRefs?: unknown[]
  checks?: unknown[]
  metrics?: unknown[]
  outcome?: string | null
  cost?: Record<string, unknown>
  evidenceRefs?: string[]
  sourceRevision?: string | null
  observedAt?: number
}): string {
  const experienceId = input.experienceId || randomUUID()
  getDatabase().prepare(`
    INSERT OR IGNORE INTO experience_events (
      workspace_id, experience_id, project_id, factory_instance_id, stage_id,
      action_type, worker_kind, worker_identity, inputs, artifact_refs, checks,
      metrics, outcome, cost, evidence_refs, source_revision, observed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
  `).run(
    input.workspaceId,
    experienceId,
    input.projectId || null,
    input.factoryInstanceId || null,
    input.stageId || null,
    input.actionType,
    input.workerKind || null,
    input.workerIdentity || null,
    JSON.stringify(input.inputs || []),
    JSON.stringify(input.artifactRefs || []),
    JSON.stringify(input.checks || []),
    JSON.stringify(input.metrics || []),
    input.outcome || null,
    JSON.stringify(input.cost || { paid_usd: 0 }),
    JSON.stringify(input.evidenceRefs || []),
    input.sourceRevision || null,
    input.observedAt || Math.floor(Date.now() / 1000),
  )
  return experienceId
}

export function recordFactorySnapshotExperience(workspaceId: number, snapshot: FactorySnapshot): string {
  const failures = snapshot.checks.filter((check) => !check.ok)
  const pendingReviews = snapshot.review_queues.filter((item) => item.status.toUpperCase() === 'PENDING')
  const outcome = snapshot.freshness.state === 'error'
    ? 'failure'
    : failures.length > 0 || pendingReviews.length > 0
      ? 'mixed'
      : 'success'
  const experienceId = `snapshot:${snapshot.instance_id}:${snapshot.source.revision}`
  const observedAt = Math.floor(Date.parse(snapshot.observed_at) / 1000) || Math.floor(Date.now() / 1000)

  recordExperience({
    workspaceId,
    experienceId,
    factoryInstanceId: snapshot.instance_id,
    stageId: snapshot.lifecycle.process_stage_id || snapshot.lifecycle.native_stage,
    actionType: 'factory_snapshot',
    workerKind: 'deterministic',
    workerIdentity: 'factory-adapter',
    checks: snapshot.checks,
    metrics: snapshot.metrics,
    outcome,
    cost: { paid_usd: 0, local_compute: true },
    evidenceRefs: [
      ...failures.map((check) => `check:${check.id}`),
      ...pendingReviews.map((review) => `review:${review.kind}`),
    ],
    sourceRevision: snapshot.source.revision,
    observedAt,
  })

  for (const check of snapshot.checks) {
    recordLearningEvidence({
      workspaceId,
      evidenceId: `snapshot-check:${snapshot.instance_id}:${snapshot.source.revision}:${check.id}`,
      evidenceType: 'deterministic_check',
      sourceType: 'experience_event',
      sourceRef: experienceId,
      result: check.ok ? 'positive' : 'negative',
      subjectKey: `${snapshot.instance_id}:check:${check.id}`,
      payload: {
        check_id: check.id,
        detail: check.detail || null,
        stage_id: snapshot.lifecycle.process_stage_id || snapshot.lifecycle.native_stage,
      },
      observedAt,
    })
  }

  return experienceId
}

export function listExperienceEvents(workspaceId: number, limit = 50): ExperienceEventRow[] {
  return getDatabase().prepare(`
    SELECT * FROM experience_events
    WHERE workspace_id = ?
    ORDER BY observed_at DESC, id DESC
    LIMIT ?
  `).all(workspaceId, Math.max(1, Math.min(500, limit))) as ExperienceEventRow[]
}

export function listImprovementCandidates(workspaceId: number, limit = 100): ImprovementCandidateRow[] {
  return getDatabase().prepare(`
    SELECT * FROM improvement_candidates
    WHERE workspace_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(workspaceId, Math.max(1, Math.min(500, limit))) as ImprovementCandidateRow[]
}

export function recordLearningEvidence(input: {
  workspaceId: number
  evidenceId?: string
  evidenceType: LearningEvidenceType
  sourceType: string
  sourceRef: string
  candidateId?: string | null
  skillRef?: string | null
  result?: LearningEvidenceResult | null
  subjectKey?: string | null
  payload?: Record<string, unknown>
  observedAt?: number
}): string {
  if (!LEARNING_EVIDENCE_TYPES.includes(input.evidenceType)) {
    throw new Error(`Unsupported learning evidence type: ${input.evidenceType}`)
  }
  if (!input.sourceType.trim() || !input.sourceRef.trim()) {
    throw new Error('Learning evidence requires sourceType and sourceRef.')
  }

  const evidenceId = input.evidenceId || randomUUID()
  const payload = {
    ...(input.payload || {}),
    ...(input.subjectKey?.trim() ? { subject_key: input.subjectKey.trim() } : {}),
  }

  getDatabase().prepare(`
    INSERT OR IGNORE INTO learning_evidence (
      workspace_id, evidence_id, evidence_type, source_type, source_ref,
      candidate_id, skill_ref, result, payload, observed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
  `).run(
    input.workspaceId,
    evidenceId,
    input.evidenceType,
    input.sourceType.trim(),
    input.sourceRef.trim(),
    input.candidateId || null,
    input.skillRef || null,
    input.result || null,
    JSON.stringify(payload),
    input.observedAt || Math.floor(Date.now() / 1000),
  )
  return evidenceId
}

export function listLearningEvidence(workspaceId: number, limit = 100): LearningEvidenceRow[] {
  return getDatabase().prepare(`
    SELECT * FROM learning_evidence
    WHERE workspace_id = ?
    ORDER BY observed_at DESC, id DESC
    LIMIT ?
  `).all(workspaceId, Math.max(1, Math.min(500, limit))) as LearningEvidenceRow[]
}

export function deterministicCandidateSignals(workspaceId: number, limit = 500) {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT evidence_type, source_ref, result, payload, observed_at
    FROM learning_evidence
    WHERE workspace_id = ? AND candidate_id IS NULL
    ORDER BY observed_at DESC, id DESC
    LIMIT ?
  `).all(workspaceId, Math.max(1, Math.min(2000, limit))) as Array<{
    evidence_type: LearningEvidenceType
    source_ref: string
    result: LearningEvidenceResult | null
    payload: string
    observed_at: number
  }>

  const activeTargets = new Set(
    (db.prepare(`
      SELECT target FROM improvement_candidates
      WHERE workspace_id = ? AND status NOT IN ('REJECTED', 'ARCHIVED')
    `).all(workspaceId) as Array<{ target: string }>).map((row) => row.target),
  )
  const grouped = new Map<string, {
    subject_key: string
    total: number
    positive: number
    negative: number
    mixed: number
    informational: number
    sources: Set<string>
    evidence_types: Set<string>
    last_observed_at: number
  }>()

  for (const row of rows) {
    let subjectKey = ''
    try {
      const payload = JSON.parse(row.payload || '{}') as { subject_key?: unknown }
      subjectKey = typeof payload.subject_key === 'string' ? payload.subject_key.trim() : ''
    } catch {
      subjectKey = ''
    }
    if (!subjectKey) continue

    const item = grouped.get(subjectKey) || {
      subject_key: subjectKey,
      total: 0,
      positive: 0,
      negative: 0,
      mixed: 0,
      informational: 0,
      sources: new Set<string>(),
      evidence_types: new Set<string>(),
      last_observed_at: 0,
    }
    item.total += 1
    if (row.result === 'positive') item.positive += 1
    else if (row.result === 'negative') item.negative += 1
    else if (row.result === 'mixed') item.mixed += 1
    else item.informational += 1
    item.sources.add(row.source_ref)
    item.evidence_types.add(row.evidence_type)
    item.last_observed_at = Math.max(item.last_observed_at, row.observed_at || 0)
    grouped.set(subjectKey, item)
  }

  return Array.from(grouped.values())
    .map((item) => {
      const uniqueSources = item.sources.size
      const problemEvidence = item.negative + item.mixed
      const hasActiveCandidate = activeTargets.has(item.subject_key)
      return {
        subject_key: item.subject_key,
        evidence_count: item.total,
        positive: item.positive,
        negative: item.negative,
        mixed: item.mixed,
        informational: item.informational,
        unique_sources: uniqueSources,
        evidence_types: Array.from(item.evidence_types).sort(),
        last_observed_at: item.last_observed_at,
        has_active_candidate: hasActiveCandidate,
        candidate_ready: item.total >= 5 && problemEvidence >= 2 && uniqueSources >= 2 && !hasActiveCandidate,
        evidence_needed: Math.max(0, 5 - item.total, 2 - problemEvidence, 2 - uniqueSources),
      }
    })
    .sort((a, b) => Number(b.candidate_ready) - Number(a.candidate_ready)
      || b.evidence_count - a.evidence_count
      || b.last_observed_at - a.last_observed_at)
}

export function createImprovementCandidate(input: {
  workspaceId: number
  scope: 'skill' | 'prompt' | 'routing' | 'check' | 'workflow' | 'policy' | 'business_rule' | 'security' | 'release' | 'permission'
  target: string
  hypothesis: string
  evidenceRefs: string[]
  sampleSize: number
  confidenceLabel?: 'low' | 'medium' | 'high'
  expectedEffect?: Record<string, unknown>
  evalPlan?: CandidateEvalPlan
  reviewPolicy?: string | null
  rollbackTarget?: string | null
}): ImprovementCandidateRow {
  const candidateId = randomUUID()
  const db = getDatabase()
  db.prepare(`
    INSERT INTO improvement_candidates (
      workspace_id, candidate_id, scope, target, status, hypothesis,
      evidence_refs, sample_size, confidence_label, expected_effect, eval_plan,
      review_policy, promotion_state, rollback_target, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'PROPOSED', ?, ?, ?, ?, ?, ?, ?, 'UNTESTED', ?, unixepoch(), unixepoch())
  `).run(
    input.workspaceId,
    candidateId,
    input.scope,
    input.target,
    input.hypothesis,
    JSON.stringify(input.evidenceRefs),
    input.sampleSize,
    input.confidenceLabel || null,
    JSON.stringify(input.expectedEffect || {}),
    JSON.stringify(input.evalPlan || {}),
    HIGH_RISK_SCOPES.has(input.scope) ? 'independent_and_human' : 'human',
    input.rollbackTarget || null,
  )
  return db.prepare(`
    SELECT * FROM improvement_candidates WHERE workspace_id = ? AND candidate_id = ?
  `).get(input.workspaceId, candidateId) as ImprovementCandidateRow
}

export function proposeReadyImprovementCandidate(input: {
  workspaceId: number
  scope: Parameters<typeof createImprovementCandidate>[0]['scope']
  target: string
  hypothesis: string
  evalPlan: CandidateEvalPlan
  rollbackTarget?: string
}): ImprovementCandidateRow {
  const db = getDatabase()
  return db.transaction(() => {
    const signal = deterministicCandidateSignals(input.workspaceId).find((item) => item.subject_key === input.target)
    if (!signal?.candidate_ready) throw new Error('Candidate evidence threshold is not met.')
    const refs = db.prepare(`
      SELECT evidence_id FROM learning_evidence
      WHERE workspace_id = ? AND candidate_id IS NULL AND json_extract(payload, '$.subject_key') = ?
      ORDER BY observed_at DESC, id DESC LIMIT 500
    `).all(input.workspaceId, input.target) as Array<{ evidence_id: string }>
    return createImprovementCandidate({
      ...input,
      evidenceRefs: refs.map((row) => row.evidence_id),
      sampleSize: refs.length,
      confidenceLabel: refs.length >= 10 ? 'medium' : 'low',
    })
  })()
}


function candidatePromotionState(status: ImprovementCandidateStatus): string {
  if (status === 'PROPOSED' || status === 'EVAL_READY') return 'UNTESTED'
  if (status === 'EVALUATING') return 'EVALUATING'
  if (status === 'REVIEW_REQUIRED' || status === 'APPROVAL_REQUIRED') return 'EVAL_PASSED'
  return status
}

function parseCandidateEvidenceRefs(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
  } catch {
    return []
  }
}

function hasCandidateEvalPlan(value: string): boolean {
  return parseEvalPlan(value) !== null
}

export function recordImprovementEvaluation(input: {
  workspaceId: number
  candidateId: string
  after: number
  sourceRef: string
  actor: string
}): { evidenceId: string; passed: boolean; effect: number } {
  if (!Number.isFinite(input.after) || !input.sourceRef.trim() || !input.actor.trim()) {
    throw new Error('Evaluation requires a finite result, source reference, and actor.')
  }
  const db = getDatabase()
  return db.transaction(() => {
    const candidate = getImprovementCandidate(input.workspaceId, input.candidateId)
    if (!candidate || candidate.status !== 'EVALUATING') throw new Error('Candidate must be EVALUATING.')
    const plan = parseEvalPlan(candidate.eval_plan)
    if (!plan) throw new Error('Evaluation plan is required.')
    const effect = plan.direction === 'increase' ? input.after - plan.baseline : plan.baseline - input.after
    const passed = effect >= plan.minimum_effect
    const evidenceId = `candidate-eval:${input.candidateId}:${randomUUID()}`
    recordLearningEvidence({
      workspaceId: input.workspaceId,
      evidenceId,
      evidenceType: 'deterministic_test',
      sourceType: 'candidate_evaluation',
      sourceRef: input.sourceRef,
      candidateId: input.candidateId,
      result: passed ? 'positive' : 'negative',
      subjectKey: candidate.target,
      payload: { candidate_eval: { ...plan, after: input.after, effect, passed, evaluated_by: input.actor } },
    })
    return { evidenceId, passed, effect }
  })()
}

export function getImprovementCandidate(workspaceId: number, candidateId: string): ImprovementCandidateRow | null {
  return (getDatabase().prepare(`
    SELECT * FROM improvement_candidates
    WHERE workspace_id = ? AND candidate_id = ?
  `).get(workspaceId, candidateId) as ImprovementCandidateRow | undefined) || null
}

export function transitionImprovementCandidate(input: {
  workspaceId: number
  candidateId: string
  expectedStatus: ImprovementCandidateStatus
  toStatus: ImprovementCandidateStatus
  actor: string
  reason?: string
  evidenceRefs?: string[]
  changeRef?: string | null
  rollbackTarget?: string | null
}): ImprovementCandidateRow {
  const actor = input.actor.trim()
  if (!actor) throw new Error('Improvement candidate transition requires an actor.')

  const reason = (input.reason || '').trim()
  const evidenceRefs = Array.from(new Set(
    (input.evidenceRefs || []).map((ref) => ref.trim()).filter(Boolean),
  ))
  const db = getDatabase()

  return db.transaction(() => {
    const current = db.prepare(`
      SELECT * FROM improvement_candidates
      WHERE workspace_id = ? AND candidate_id = ?
    `).get(input.workspaceId, input.candidateId) as ImprovementCandidateRow | undefined

    if (!current) throw new Error('Improvement candidate not found.')
    if (current.status !== input.expectedStatus) {
      throw new Error(
        `Improvement candidate changed before transition. Expected ${input.expectedStatus}, found ${current.status}.`,
      )
    }

    const fromStatus = current.status as ImprovementCandidateStatus
    if (!IMPROVEMENT_CANDIDATE_STATUSES.includes(fromStatus)) {
      throw new Error(`Unsupported improvement candidate status: ${current.status}`)
    }
    if (!IMPROVEMENT_CANDIDATE_TRANSITIONS[fromStatus].includes(input.toStatus)) {
      throw new Error(`Invalid improvement candidate transition: ${fromStatus} -> ${input.toStatus}`)
    }

    if (input.toStatus === 'EVAL_READY' && !hasCandidateEvalPlan(current.eval_plan)) {
      throw new Error('Evaluation plan is required before EVAL_READY.')
    }
    const allRefs = Array.from(new Set([...parseCandidateEvidenceRefs(current.evidence_refs), ...evidenceRefs]))
    const evalRows = allRefs.map((ref) => db.prepare(`
      SELECT evidence_type, result, payload, candidate_id FROM learning_evidence
      WHERE workspace_id = ? AND evidence_id = ?
    `).get(input.workspaceId, ref) as { evidence_type: string; result: string | null; payload: string; candidate_id: string | null } | undefined)
    const passedEval = evalRows.find((row) => {
      if (row?.evidence_type !== 'deterministic_test' || row.result !== 'positive'
        || row.candidate_id !== input.candidateId) return false
      try {
        const evaluation = JSON.parse(row.payload).candidate_eval
        return evaluation?.passed === true && Number.isFinite(evaluation.baseline)
          && Number.isFinite(evaluation.after) && Number.isFinite(evaluation.effect)
      } catch { return false }
    })
    if ((input.toStatus === 'REVIEW_REQUIRED' || input.toStatus === 'PROMOTED') && !passedEval) {
      throw new Error('Passing evaluation evidence with baseline comparison is required.')
    }
    if (input.toStatus === 'APPROVAL_REQUIRED' && HIGH_RISK_SCOPES.has(current.scope)) {
      const evaluation = JSON.parse(passedEval?.payload || '{}').candidate_eval
      if (!evaluation || evaluation.evaluated_by === actor) {
        throw new Error('High-risk candidate requires independent review.')
      }
    }
    if (input.toStatus === 'REINFORCED' && evidenceRefs.length === 0) {
      throw new Error('Observation evidence is required before REINFORCED.')
    }

    const changeRef = input.changeRef?.trim() || current.change_ref
    const rollbackTarget = input.rollbackTarget?.trim() || current.rollback_target

    if (input.toStatus === 'PROMOTED') {
      if (!reason) throw new Error('Promotion requires an approval reason.')
      if (!changeRef) throw new Error('Promotion requires a change reference.')
      if (!rollbackTarget) throw new Error('Promotion requires a rollback target.')
      const seedRows = evalRows.filter((row) => row && row.candidate_id !== input.candidateId)
      if (seedRows.length === 0) throw new Error('Promotion requires original learning evidence.')
      const review = db.prepare(`
        SELECT worker_identity FROM experience_events
        WHERE workspace_id = ? AND action_type = 'improvement_candidate_transition'
          AND stage_id = 'APPROVAL_REQUIRED' AND json_extract(inputs, '$[0].candidate_id') = ?
        ORDER BY id DESC LIMIT 1
      `).get(input.workspaceId, input.candidateId) as { worker_identity: string | null } | undefined
      if (!review?.worker_identity) throw new Error('Promotion requires human review.')
    }
    if (input.toStatus === 'ROLLED_BACK') {
      if (!reason) throw new Error('Rollback requires a reason.')
      if (!rollbackTarget) throw new Error('Rollback requires a rollback target.')
    }

    for (const evidenceRef of evidenceRefs) {
      const linked = db.prepare(`
        SELECT candidate_id FROM learning_evidence
        WHERE workspace_id = ? AND evidence_id = ?
      `).get(input.workspaceId, evidenceRef) as { candidate_id: string | null } | undefined

      if (!linked) throw new Error(`Learning evidence not found: ${evidenceRef}`)
      if (linked.candidate_id && linked.candidate_id !== input.candidateId) {
        throw new Error(`Learning evidence is already assigned to another candidate: ${evidenceRef}`)
      }
    }

    const combinedEvidenceRefs = Array.from(new Set([
      ...parseCandidateEvidenceRefs(current.evidence_refs),
      ...evidenceRefs,
    ]))
    const promotionState = candidatePromotionState(input.toStatus)
    const updated = db.prepare(`
      UPDATE improvement_candidates
      SET status = ?,
          promotion_state = ?,
          evidence_refs = ?,
          change_ref = ?,
          rollback_target = ?,
          updated_at = unixepoch()
      WHERE workspace_id = ? AND candidate_id = ? AND status = ?
    `).run(
      input.toStatus,
      promotionState,
      JSON.stringify(combinedEvidenceRefs),
      changeRef || null,
      rollbackTarget || null,
      input.workspaceId,
      input.candidateId,
      fromStatus,
    )

    if (updated.changes !== 1) {
      throw new Error('Improvement candidate changed before transition.')
    }

    for (const evidenceRef of evidenceRefs) {
      db.prepare(`
        UPDATE learning_evidence
        SET candidate_id = ?
        WHERE workspace_id = ? AND evidence_id = ?
          AND (candidate_id IS NULL OR candidate_id = ?)
      `).run(input.candidateId, input.workspaceId, evidenceRef, input.candidateId)
    }

    recordExperience({
      workspaceId: input.workspaceId,
      experienceId: `candidate-transition:${input.candidateId}:${randomUUID()}`,
      stageId: input.toStatus,
      actionType: 'improvement_candidate_transition',
      workerKind: 'human',
      workerIdentity: actor,
      inputs: [{
        candidate_id: input.candidateId,
        from_status: fromStatus,
        to_status: input.toStatus,
        reason,
        change_ref: changeRef || null,
        rollback_target: rollbackTarget || null,
      }],
      evidenceRefs,
      outcome: 'success',
      cost: { paid_usd: 0, local_compute: true },
    })

    return db.prepare(`
      SELECT * FROM improvement_candidates
      WHERE workspace_id = ? AND candidate_id = ?
    `).get(input.workspaceId, input.candidateId) as ImprovementCandidateRow
  })()
}


export function deterministicLearningAggregates(workspaceId: number, limit = 500) {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT factory_instance_id, action_type, outcome, checks, metrics, observed_at
    FROM experience_events
    WHERE workspace_id = ?
    ORDER BY observed_at DESC, id DESC
    LIMIT ?
  `).all(workspaceId, Math.max(1, Math.min(2000, limit))) as Array<{
    factory_instance_id: string | null
    action_type: string
    outcome: string | null
    checks: string
    metrics: string
    observed_at: number
  }>

  const byFactory = new Map<string, {
    factory_instance_id: string
    events: number
    success: number
    mixed: number
    failure: number
    last_observed_at: number
  }>()
  const checkFailures = new Map<string, {
    check_id: string
    count: number
    factories: Set<string>
    last_observed_at: number
  }>()

  for (const row of rows) {
    const factory = row.factory_instance_id || 'unscoped'
    const rollup = byFactory.get(factory) || {
      factory_instance_id: factory,
      events: 0,
      success: 0,
      mixed: 0,
      failure: 0,
      last_observed_at: 0,
    }
    rollup.events += 1
    if (row.outcome === 'success') rollup.success += 1
    else if (row.outcome === 'mixed') rollup.mixed += 1
    else if (row.outcome === 'failure') rollup.failure += 1
    rollup.last_observed_at = Math.max(rollup.last_observed_at, row.observed_at || 0)
    byFactory.set(factory, rollup)

    try {
      const checks = JSON.parse(row.checks || '[]') as Array<{ id?: string; ok?: boolean }>
      for (const check of checks) {
        if (check?.ok !== false || !check.id) continue
        const item = checkFailures.get(check.id) || {
          check_id: check.id,
          count: 0,
          factories: new Set<string>(),
          last_observed_at: 0,
        }
        item.count += 1
        item.factories.add(factory)
        item.last_observed_at = Math.max(item.last_observed_at, row.observed_at || 0)
        checkFailures.set(check.id, item)
      }
    } catch {
      // Malformed historical evidence is ignored by deterministic aggregation.
    }
  }

  const reflectionThreshold = 5
  const factoryRollups = Array.from(byFactory.values())
    .sort((a, b) => b.last_observed_at - a.last_observed_at)
    .map((item) => ({
      ...item,
      reflection_eligible: item.events >= reflectionThreshold,
      evidence_needed: Math.max(0, reflectionThreshold - item.events),
    }))

  const recurringFailures = Array.from(checkFailures.values())
    .map((item) => ({
      check_id: item.check_id,
      count: item.count,
      factories: Array.from(item.factories).sort(),
      last_observed_at: item.last_observed_at,
      recurring: item.count >= 2,
    }))
    .sort((a, b) => b.count - a.count || b.last_observed_at - a.last_observed_at)

  return {
    window_events: rows.length,
    reflection_threshold: reflectionThreshold,
    factory_rollups: factoryRollups,
    recurring_check_failures: recurringFailures,
  }
}

export function learningSummary(workspaceId: number) {
  const db = getDatabase()
  const events = (db.prepare(`SELECT COUNT(*) as count FROM experience_events WHERE workspace_id = ?`).get(workspaceId) as { count: number }).count
  const candidates = (db.prepare(`SELECT COUNT(*) as count FROM improvement_candidates WHERE workspace_id = ?`).get(workspaceId) as { count: number }).count
  const activeCandidates = (db.prepare(`
    SELECT COUNT(*) as count FROM improvement_candidates
    WHERE workspace_id = ? AND status NOT IN ('REJECTED', 'ARCHIVED')
  `).get(workspaceId) as { count: number }).count
  const evidence = (db.prepare(`SELECT COUNT(*) as count FROM learning_evidence WHERE workspace_id = ?`).get(workspaceId) as { count: number }).count
  const paid = db.prepare(`
    SELECT cost FROM experience_events
    WHERE workspace_id = ?
    ORDER BY observed_at DESC
    LIMIT 500
  `).all(workspaceId) as Array<{ cost: string }>
  const paidUsd = paid.reduce((sum, row) => {
    try {
      const parsed = JSON.parse(row.cost || '{}') as { paid_usd?: number }
      return sum + (Number(parsed.paid_usd) || 0)
    } catch {
      return sum
    }
  }, 0)

  return {
    events,
    candidates,
    active_candidates: activeCandidates,
    evidence,
    measured_paid_usd_recent: paidUsd,
    default_policy: {
      mode: 'economical',
      passive_logging: true,
      deterministic_analysis: true,
      reflection_min_new_evidence: 5,
      paid_api_default_hard_cap_usd_per_day: 0,
      optimizer_auto_run: false,
    },
  }
}
