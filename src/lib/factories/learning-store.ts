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

  return recordExperience({
    workspaceId,
    experienceId: `snapshot:${snapshot.instance_id}:${snapshot.source.revision}`,
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
    observedAt: Math.floor(Date.parse(snapshot.observed_at) / 1000) || Math.floor(Date.now() / 1000),
  })
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

export function createImprovementCandidate(input: {
  workspaceId: number
  scope: 'skill' | 'prompt' | 'routing' | 'check' | 'workflow' | 'policy'
  target: string
  hypothesis: string
  evidenceRefs: string[]
  sampleSize: number
  confidenceLabel?: 'low' | 'medium' | 'high'
  expectedEffect?: Record<string, unknown>
  evalPlan?: Record<string, unknown>
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
    input.reviewPolicy || null,
    input.rollbackTarget || null,
  )
  return db.prepare(`
    SELECT * FROM improvement_candidates WHERE workspace_id = ? AND candidate_id = ?
  `).get(input.workspaceId, candidateId) as ImprovementCandidateRow
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
