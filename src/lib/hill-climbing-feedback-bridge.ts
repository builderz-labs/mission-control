/**
 * Hill-Climbing → Self-Learning Feedback Bridge
 * WHY: Closes the feedback loop between hill-climbing optimizer outcomes
 * and the learned_patterns table. When variant B wins, the new config is
 * stored as a pattern with higher confidence. Losing patterns decay.
 *
 * This ensures Ultron gets smarter from each A/B comparison — not just
 * at the level of individual tasks but across repeated operation types.
 */

import { getDatabase } from './db'
import { logger } from './logger'
import { emitPatternStored } from './autonomous-events'
import type { ComparisonResult, TrajectoryComparison } from './hill-climbing'
import { MAX_CONFIDENCE, CONFIDENCE_BOOST_SUCCESS, CONFIDENCE_PENALTY_FAILURE, MIN_CONFIDENCE } from './self-learning-types'

// ---------------------------------------------------------------------------
// Per-actionTaken confidence adjustments
// ---------------------------------------------------------------------------

/**
 * Records that a specific action pattern succeeded, boosting its confidence.
 */
export function reinforcePatternByAction(actionTaken: string, workspaceId = 1): void {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  db.prepare(`
    UPDATE learned_patterns
    SET confidence = MIN(?, confidence + ?),
        usage_count = usage_count + 1,
        outcome = 'success',
        last_used_at = ?,
        updated_at = ?
    WHERE action_taken = ? AND workspace_id = ?
  `).run(MAX_CONFIDENCE, CONFIDENCE_BOOST_SUCCESS, now, now, actionTaken, workspaceId)
}

/**
 * Records that a specific action pattern failed, decaying its confidence.
 */
export function decayPatternByAction(actionTaken: string, workspaceId = 1): void {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  db.prepare(`
    UPDATE learned_patterns
    SET confidence = MAX(?, confidence - ?),
        usage_count = usage_count + 1,
        outcome = 'failure',
        updated_at = ?
    WHERE action_taken = ? AND workspace_id = ?
  `).run(MIN_CONFIDENCE, CONFIDENCE_PENALTY_FAILURE, now, actionTaken, workspaceId)
}

// ---------------------------------------------------------------------------
// Bridge: hill-climbing winner → learned_patterns
// ---------------------------------------------------------------------------

/**
 * Bridges a completed hill-climbing comparison into learned_patterns.
 * WHY: The winning config variant is stored as a high-confidence pattern so
 * future suggestions benefit from the A/B result without re-running the test.
 */
export function bridgeComparisonToPattern(
  comparisonId: number,
  result: ComparisonResult,
  workspaceId = 1,
): void {
  if (result.winner === 'tie') {
    logger.debug({ comparisonId }, 'Hill-climbing tie — no pattern update')
    return
  }

  const db = getDatabase()
  const row = db.prepare(
    'SELECT id, operation_name, config_a, config_b, metric_name, value_a, value_b, winner, confidence, workspace_id, created_at, resolved_at FROM trajectory_comparisons WHERE id = ?',
  ).get(comparisonId) as TrajectoryComparison | undefined

  if (!row) {
    logger.warn({ comparisonId }, 'bridgeComparisonToPattern: comparison not found')
    return
  }

  const winningConfigJson = result.winner === 'b' ? row.config_b : row.config_a
  const actionTaken = `${row.operation_name}:${result.winner}_wins`
  const now = Math.floor(Date.now() / 1000)

  // Winning confidence is capped at MAX_CONFIDENCE; bump it to at least 0.6
  const patternConfidence = Math.min(result.confidence + 0.5, MAX_CONFIDENCE)

  const existing = db.prepare(
    'SELECT id FROM learned_patterns WHERE action_taken = ? AND workspace_id = ? LIMIT 1',
  ).get(actionTaken, workspaceId) as { id: number } | undefined

  if (existing) {
    reinforcePatternByAction(actionTaken, workspaceId)
    logger.info(
      { comparisonId, winner: result.winner, actionTaken, patternConfidence },
      'Hill-climbing result bridged to learned_patterns (reinforced)',
    )
    emitPatternStored(existing.id, 'hill_climbing', patternConfidence)
  } else {
    const insertResult = db.prepare(`
      INSERT INTO learned_patterns
        (pattern_type, trigger_context, action_taken, outcome, confidence, usage_count, last_used_at, workspace_id, created_at, updated_at)
      VALUES ('hill_climbing', ?, ?, 'success', ?, 1, ?, ?, ?, ?)
    `).run(winningConfigJson, actionTaken, patternConfidence, now, workspaceId, now, now)
    const newId = Number(insertResult.lastInsertRowid)
    logger.info(
      { comparisonId, winner: result.winner, actionTaken, patternConfidence, newId },
      'Hill-climbing result bridged to learned_patterns (new)',
    )
    // WHY: Emit learning event so the SSE bus notifies any listening panels in real time,
    // consistent with how all other pattern-store paths signal the ecosystem.
    emitPatternStored(newId, 'hill_climbing', patternConfidence)
  }
}
