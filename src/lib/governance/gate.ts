/**
 * Governance Gate Engine
 * WHY: Acts as the enforcement layer for the LACP quality gate protocol.
 * Every agent output can be scored before being accepted into the system,
 * preventing low-quality outputs from propagating downstream.
 */

import { getDatabase } from '../db'
import { logger } from '../logger'
import { emitGatePassed, emitGateFailed, emitReviewRequired } from '../autonomous-events'
import type { GateResult, EvaluateInput, GateOutcome, GovernanceRule } from './types'
import { computeWeightedScore, GATE_PASS_THRESHOLD, DEFAULT_GATE_DIMENSIONS } from './defaults'

interface GovernanceResultRow {
  passed: number
  override_by: string | null
}

export class GovernanceGateEngine {
  private constructor() {}

  static getInstance(): GovernanceGateEngine {
    const g = globalThis as typeof globalThis & { __governanceGate?: GovernanceGateEngine }
    g.__governanceGate ??= new GovernanceGateEngine()
    return g.__governanceGate
  }

  /**
   * Evaluates a task/output against the governance gate.
   * Persists result to governance_results table.
   */
  evaluate(input: EvaluateInput): GateResult {
    const { taskId, gateType, scores, workspaceId = 1, overrideBy } = input
    const rules = this.getRules(gateType, workspaceId)

    // Use custom workspace rules if they exist, otherwise fall back to defaults
    const dimConfigs = rules.length > 0
      ? rules.map(r => ({ dimension: r.dimension, weight: r.weight, threshold: r.threshold }))
      : DEFAULT_GATE_DIMENSIONS

    const totalScore = computeWeightedScore(scores, dimConfigs)
    const passed = overrideBy != null ? true : totalScore >= GATE_PASS_THRESHOLD

    const enrichedScores = scores.map(s => {
      const config = dimConfigs.find(d => d.dimension === s.dimension)
        ?? { weight: 0, threshold: 0, dimension: s.dimension }
      return { dimension: s.dimension, score: s.score, weight: config.weight, notes: s.notes }
    })

    const db = getDatabase()
    const result = db.prepare(`
      INSERT INTO governance_results (task_id, gate_type, total_score, passed, scores, override_by, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(taskId ?? null, gateType, totalScore, passed ? 1 : 0, JSON.stringify(enrichedScores), overrideBy ?? null, workspaceId)

    const id = result.lastInsertRowid as number

    if (passed) {
      emitGatePassed(taskId, gateType, totalScore)
    } else {
      emitGateFailed(taskId, gateType, totalScore, GATE_PASS_THRESHOLD)
    }

    logger.info({ id, taskId, gateType, totalScore, passed }, 'Governance gate evaluated')

    return {
      id,
      taskId,
      gateType,
      totalScore,
      passed,
      scores: enrichedScores,
      overrideBy: overrideBy ?? null,
      workspaceId,
      evaluatedAt: Math.floor(Date.now() / 1000),
    }
  }

  checkGate(taskId: number | null, gateType: string, workspaceId: number = 1): GateOutcome {
    const db = getDatabase()
    const row = db.prepare(`
      SELECT passed, override_by FROM governance_results
      WHERE task_id IS ? AND gate_type = ? AND workspace_id = ?
      ORDER BY evaluated_at DESC LIMIT 1
    `).get(taskId ?? null, gateType, workspaceId) as GovernanceResultRow | undefined

    if (!row) {
      emitReviewRequired(taskId, gateType, 'No evaluation found')
      return 'failed'
    }
    if (row.override_by) return 'override'
    return row.passed ? 'passed' : 'failed'
  }

  listResults(workspaceId: number = 1, limit: number = 20): ReadonlyArray<GateResult> {
    const db = getDatabase()
    return db.prepare(`
      SELECT id, task_id AS taskId, gate_type AS gateType, total_score AS totalScore,
             passed, scores, override_by AS overrideBy, workspace_id AS workspaceId, evaluated_at AS evaluatedAt
      FROM governance_results WHERE workspace_id = ? ORDER BY evaluated_at DESC LIMIT ?
    `).all(workspaceId, limit) as GateResult[]
  }

  upsertRule(rule: Omit<GovernanceRule, 'id'>): void {
    const db = getDatabase()
    // WHY: ON CONFLICT requires a UNIQUE index — migration 054 adds idx_gov_rules_uq.
    // DO UPDATE ensures weight/threshold changes are applied, not silently discarded.
    db.prepare(`
      INSERT INTO governance_rules (gate_type, dimension, weight, threshold, workspace_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(gate_type, dimension, workspace_id)
        DO UPDATE SET weight = excluded.weight, threshold = excluded.threshold
    `).run(rule.gateType, rule.dimension, rule.weight, rule.threshold, rule.workspaceId)
  }

  private getRules(gateType: string, workspaceId: number): ReadonlyArray<GovernanceRule> {
    const db = getDatabase()
    return db.prepare(`
      SELECT id, gate_type AS gateType, dimension, weight, threshold, workspace_id AS workspaceId
      FROM governance_rules WHERE gate_type = ? AND workspace_id = ?
    `).all(gateType, workspaceId) as GovernanceRule[]
  }
}
