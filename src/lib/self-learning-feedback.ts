// ---------------------------------------------------------------------------
// Self-Learning — decay engine and feedback integration
// ---------------------------------------------------------------------------
import { getDatabase } from './db'
import { logger } from './logger'
import {
  type FeedbackEntry,
  type LearnedPattern,
  MIN_CONFIDENCE,
  MAX_CONFIDENCE,
  DECAY_RATE,
  DECAY_INTERVAL_SECONDS,
  CONFIDENCE_BOOST_SUCCESS,
  CONFIDENCE_PENALTY_FAILURE,
  DEFAULT_LIMIT,
  RECENT_FEEDBACK_WINDOW_DAYS,
} from './self-learning-types'
import { getPatternById } from './self-learning-patterns'

// ---------------------------------------------------------------------------
// Decay engine
// ---------------------------------------------------------------------------

export function applyDecay(workspaceId = 1): number {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now - DECAY_INTERVAL_SECONDS

  const result = db.prepare(`
    UPDATE learned_patterns
    SET decay_factor = MAX(?, decay_factor - ?), updated_at = ?
    WHERE workspace_id = ? AND last_used_at < ? AND decay_factor > ?
  `).run(MIN_CONFIDENCE, DECAY_RATE, now, workspaceId, cutoff, MIN_CONFIDENCE)

  if (result.changes > 0) {
    logger.info({ decayed: result.changes, workspaceId }, 'Applied pattern decay')
  }
  return result.changes
}

export function refreshPatternUsage(
  patternId: number,
  workspaceId = 1,
): LearnedPattern | null {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  db.prepare(`
    UPDATE learned_patterns
    SET usage_count = usage_count + 1,
        last_used_at = ?,
        decay_factor = MIN(1.0, decay_factor + ?),
        updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `).run(now, DECAY_RATE, now, patternId, workspaceId)

  return getPatternById(patternId, workspaceId)
}

// ---------------------------------------------------------------------------
// Feedback integration
// ---------------------------------------------------------------------------

interface RecordFeedbackInput {
  readonly taskId?: number
  readonly patternId?: number
  readonly rating: number
  readonly correction?: string
  readonly workspaceId?: number
}

export function recordFeedback(input: RecordFeedbackInput): FeedbackEntry {
  const db = getDatabase()
  const workspaceId = input.workspaceId ?? 1

  if (input.rating < 1 || input.rating > 5) {
    throw new Error('Rating must be between 1 and 5')
  }

  const result = db.prepare(`
    INSERT INTO feedback_entries
      (task_id, pattern_id, rating, correction, workspace_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    input.taskId ?? null,
    input.patternId ?? null,
    input.rating,
    input.correction ?? null,
    workspaceId,
  )

  // Immediately adjust pattern confidence when feedback references a pattern
  if (input.patternId != null) {
    updatePatternFromFeedback(input.patternId, input.rating, workspaceId)
  }

  logger.info({ patternId: input.patternId, rating: input.rating }, 'Recorded feedback entry')
  return getFeedbackById(Number(result.lastInsertRowid), workspaceId)!
}

function getFeedbackById(id: number, workspaceId = 1): FeedbackEntry | null {
  const db = getDatabase()
  const row = db.prepare(
    'SELECT id, task_id, pattern_id, rating, correction, applied, workspace_id, created_at FROM feedback_entries WHERE id = ? AND workspace_id = ?',
  ).get(id, workspaceId) as FeedbackEntry | undefined
  return row ?? null
}

function updatePatternFromFeedback(
  patternId: number,
  rating: number,
  workspaceId: number,
): void {
  const pattern = getPatternById(patternId, workspaceId)
  if (!pattern) return

  const adjustment = computeConfidenceAdjustment(rating)
  const newConfidence = clampConfidence(pattern.confidence + adjustment)
  const now = Math.floor(Date.now() / 1000)

  getDatabase().prepare(`
    UPDATE learned_patterns
    SET confidence = ?, updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `).run(newConfidence, now, patternId, workspaceId)
}

function computeConfidenceAdjustment(rating: number): number {
  // 5 = strong positive, 1 = strong negative, 3 = neutral
  if (rating >= 4) return CONFIDENCE_BOOST_SUCCESS * (rating - 3)
  if (rating <= 2) return -CONFIDENCE_PENALTY_FAILURE * (3 - rating)
  return 0
}

function clampConfidence(value: number): number {
  return Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, value))
}

export function getRecentFeedback(
  workspaceId = 1,
  limit = DEFAULT_LIMIT,
): readonly FeedbackEntry[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT id, task_id, pattern_id, rating, correction, applied, workspace_id, created_at
    FROM feedback_entries
    WHERE workspace_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspaceId, limit) as FeedbackEntry[]
}

export function markFeedbackApplied(
  feedbackId: number,
  workspaceId = 1,
): FeedbackEntry | null {
  const db = getDatabase()
  db.prepare(`
    UPDATE feedback_entries SET applied = 1
    WHERE id = ? AND workspace_id = ?
  `).run(feedbackId, workspaceId)
  return getFeedbackById(feedbackId, workspaceId)
}
