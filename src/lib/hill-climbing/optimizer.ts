/**
 * Hill-Climbing Optimizer
 * WHY: Implements the hill-climbing loop from AutoAgent ATIF-v1.6 (MIT license).
 * Proposes config variants, records metric outcomes, crowns winners.
 * Safe to use concurrently — each comparison is a separate DB row.
 */

import { getDatabase } from '../db'
import { logger } from '../logger'
import type {
  TrajectoryComparison,
  RecordOutcomeInput,
  ComparisonResult,
  ProposeVariantOptions,
} from './types'

// Minimum absolute delta to declare a winner (not 'tie')
const MIN_WINNER_DELTA = 0.05
// Confidence capped at 0.99 to avoid overconfident convergence
const MAX_CONFIDENCE = 0.99

export class HillClimbingOptimizer {
  private constructor() {}

  static getInstance(): HillClimbingOptimizer {
    const g = globalThis as typeof globalThis & { __hillClimber?: HillClimbingOptimizer }
    g.__hillClimber ??= new HillClimbingOptimizer()
    return g.__hillClimber
  }

  /**
   * Proposes a mutated variant B from the current config.
   * Uses small random perturbations on numeric fields — no external LLM needed,
   * keeping the feedback loop fully offline and deterministic in distribution.
   */
  proposeVariant(
    currentConfig: Record<string, unknown>,
    options: ProposeVariantOptions = {},
  ): Record<string, unknown> {
    const { mutationRate = 0.2, fields } = options
    const variant: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(currentConfig)) {
      const shouldMutate = (!fields || fields.includes(key)) && Math.random() < mutationRate
      if (shouldMutate && typeof value === 'number') {
        // Gaussian-like perturbation: ±20% of original value
        const delta = value * (Math.random() * 0.4 - 0.2)
        variant[key] = Math.round((value + delta) * 1000) / 1000
      } else {
        variant[key] = value
      }
    }

    return variant
  }

  /**
   * Creates a new A/B comparison record and returns its ID.
   */
  createComparison(
    operationName: string,
    configA: Record<string, unknown>,
    configB: Record<string, unknown>,
    metricName: string,
    workspaceId = 1,
  ): number {
    const db = getDatabase()
    const result = db.prepare(`
      INSERT INTO trajectory_comparisons (operation_name, config_a, config_b, metric_name, workspace_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(operationName, JSON.stringify(configA), JSON.stringify(configB), metricName, workspaceId)

    const id = Number(result.lastInsertRowid)
    logger.debug({ id, operationName, metricName }, 'Hill-climbing comparison created')
    return id
  }

  /**
   * Records the metric outcome for one variant of a comparison.
   */
  recordOutcome(input: RecordOutcomeInput): void {
    const db = getDatabase()
    const col = input.variant === 'a' ? 'value_a' : 'value_b'

    // Safe: col is derived from the enum 'a' | 'b', never user input
    db.prepare(`UPDATE trajectory_comparisons SET ${col} = ? WHERE id = ?`)
      .run(input.value, input.comparisonId)

    logger.debug(
      { comparisonId: input.comparisonId, variant: input.variant, value: input.value },
      'Hill-climbing outcome recorded',
    )
  }

  /**
   * Evaluates the comparison once both variants have outcomes.
   * Higher metric value = better (caller decides metric direction).
   */
  evaluateComparison(comparisonId: number): ComparisonResult {
    const db = getDatabase()
    const row = db.prepare(
      'SELECT id, operation_name, config_a, config_b, metric_name, value_a, value_b, winner, confidence, workspace_id, created_at, resolved_at FROM trajectory_comparisons WHERE id = ?',
    ).get(comparisonId) as TrajectoryComparison | undefined

    if (!row) {
      throw new Error(`Hill-climbing comparison ${comparisonId} not found`)
    }
    if (row.value_a === null || row.value_b === null) {
      throw new Error(
        `Comparison ${comparisonId} missing outcomes (a=${row.value_a}, b=${row.value_b})`,
      )
    }

    const delta = row.value_b - row.value_a
    const absDelta = Math.abs(delta)
    const maxVal = Math.max(Math.abs(row.value_a), Math.abs(row.value_b), 0.001)
    const confidence = Math.min(absDelta / maxVal, MAX_CONFIDENCE)

    const winner: 'a' | 'b' | 'tie' = absDelta < MIN_WINNER_DELTA
      ? 'tie'
      : delta > 0 ? 'b' : 'a'

    db.prepare(`
      UPDATE trajectory_comparisons
      SET winner = ?, confidence = ?, resolved_at = unixepoch()
      WHERE id = ?
    `).run(winner, confidence, comparisonId)

    logger.info({ comparisonId, winner, confidence, delta }, 'Hill-climbing comparison resolved')

    return { winner, confidence, valueA: row.value_a, valueB: row.value_b, delta }
  }

  listComparisons(
    operationName: string,
    workspaceId = 1,
    limit = 20,
  ): ReadonlyArray<TrajectoryComparison> {
    const db = getDatabase()
    return db.prepare(`
      SELECT id, operation_name, config_a, config_b, metric_name, value_a, value_b,
             winner, confidence, workspace_id, created_at, resolved_at
      FROM trajectory_comparisons
      WHERE operation_name = ? AND workspace_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(operationName, workspaceId, limit) as TrajectoryComparison[]
  }
}
