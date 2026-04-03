// ---------------------------------------------------------------------------
// Self-Learning — pattern CRUD, suggestion, and deduplication
// ---------------------------------------------------------------------------
import { getDatabase } from './db'
import { logger } from './logger'
import {
  type LearnedPattern,
  type PatternOutcome,
  type PatternSuggestion,
  MIN_CONFIDENCE,
  DECAY_RATE,
  CONFIDENCE_BOOST_SUCCESS,
  CONFIDENCE_PENALTY_FAILURE,
  CONFIDENCE_PARTIAL,
  DEFAULT_LIMIT,
  SUGGESTION_LIMIT,
} from './self-learning-types'

// ---------------------------------------------------------------------------
// Shared utilities (also consumed by self-learning-traces)
// ---------------------------------------------------------------------------

export function extractKeywords(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[\s,.:;!?'"()\[\]{}|/\\]+/)
    .filter((word) => word.length > 2)
}

export function clampConfidence(value: number): number {
  return Math.max(MIN_CONFIDENCE, Math.min(0.99, value))
}

function computeRelevance(
  pattern: LearnedPattern,
  keywords: readonly string[],
): number {
  const contextWords = extractKeywords(pattern.trigger_context)
  const matchCount = keywords.filter((kw) => contextWords.includes(kw)).length
  if (matchCount === 0) return 0

  const keywordScore = matchCount / Math.max(keywords.length, 1)
  const effectiveConfidence = pattern.confidence * pattern.decay_factor
  return keywordScore * effectiveConfidence
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

const PATTERN_COLUMNS =
  'id, pattern_type, trigger_context, action_taken, outcome, confidence, usage_count, last_used_at, decay_factor, workspace_id, created_at, updated_at'

interface RecordPatternInput {
  readonly patternType: string
  readonly triggerContext: string
  readonly actionTaken: string
  readonly outcome: PatternOutcome
  readonly workspaceId?: number
}

export function recordPattern(input: RecordPatternInput): LearnedPattern {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const workspaceId = input.workspaceId ?? 1
  const initialConfidence = computeInitialConfidence(input.outcome)

  const result = db.prepare(`
    INSERT INTO learned_patterns
      (pattern_type, trigger_context, action_taken, outcome, confidence, usage_count, last_used_at, workspace_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(
    input.patternType, input.triggerContext, input.actionTaken,
    input.outcome, initialConfidence, now, workspaceId, now, now,
  )

  logger.info({ patternType: input.patternType, outcome: input.outcome }, 'Recorded learned pattern')
  return getPatternById(Number(result.lastInsertRowid), workspaceId)!
}

function computeInitialConfidence(outcome: PatternOutcome): number {
  switch (outcome) {
    case 'success': return 0.6
    case 'partial': return 0.4
    case 'failure': return 0.2
  }
}

export function getPatternById(id: number, workspaceId = 1): LearnedPattern | null {
  const db = getDatabase()
  const row = db.prepare(
    `SELECT ${PATTERN_COLUMNS} FROM learned_patterns WHERE id = ? AND workspace_id = ?`,
  ).get(id, workspaceId) as LearnedPattern | undefined
  return row ?? null
}

export function getTopPatterns(
  workspaceId = 1,
  limit = DEFAULT_LIMIT,
): readonly LearnedPattern[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT ${PATTERN_COLUMNS}
    FROM learned_patterns
    WHERE workspace_id = ? AND confidence * decay_factor > ?
    ORDER BY (confidence * decay_factor * usage_count) DESC
    LIMIT ?
  `).all(workspaceId, MIN_CONFIDENCE, limit) as LearnedPattern[]
}

// ---------------------------------------------------------------------------
// Suggestion
// ---------------------------------------------------------------------------

export function suggestPatterns(
  triggerContext: string,
  patternType: string,
  workspaceId = 1,
): readonly PatternSuggestion[] {
  const db = getDatabase()

  const candidates = db.prepare(`
    SELECT ${PATTERN_COLUMNS}
    FROM learned_patterns
    WHERE workspace_id = ? AND pattern_type = ? AND confidence * decay_factor > ?
    ORDER BY confidence DESC
    LIMIT ?
  `).all(workspaceId, patternType, MIN_CONFIDENCE, SUGGESTION_LIMIT * 3) as LearnedPattern[]

  const keywords = extractKeywords(triggerContext)

  return candidates
    .map((pattern) => ({ pattern, relevanceScore: computeRelevance(pattern, keywords) } as const))
    .filter((s) => s.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, SUGGESTION_LIMIT)
}

// ---------------------------------------------------------------------------
// Deduplication / reinforcement
// ---------------------------------------------------------------------------

export function findExistingPattern(
  patternType: string,
  actionTaken: string,
  workspaceId = 1,
): LearnedPattern | null {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT ${PATTERN_COLUMNS}
    FROM learned_patterns
    WHERE workspace_id = ? AND pattern_type = ? AND action_taken = ?
    ORDER BY confidence DESC
    LIMIT 1
  `).get(workspaceId, patternType, actionTaken) as LearnedPattern | undefined
  return row ?? null
}

export function recordOrReinforcePattern(input: RecordPatternInput): LearnedPattern {
  const existing = findExistingPattern(
    input.patternType,
    input.actionTaken,
    input.workspaceId ?? 1,
  )
  if (existing) {
    return reinforceExistingPattern(existing, input.outcome) ?? existing
  }
  return recordPattern(input)
}

function reinforceExistingPattern(
  pattern: LearnedPattern,
  outcome: PatternOutcome,
): LearnedPattern | null {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const adjustment = outcomeToConfidenceAdjustment(outcome)
  const newConfidence = clampConfidence(pattern.confidence + adjustment)

  db.prepare(`
    UPDATE learned_patterns
    SET confidence = ?, outcome = ?, usage_count = usage_count + 1,
        last_used_at = ?, decay_factor = MIN(1.0, decay_factor + ?), updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `).run(newConfidence, outcome, now, DECAY_RATE, now, pattern.id, pattern.workspace_id)

  return getPatternById(pattern.id, pattern.workspace_id)
}

function outcomeToConfidenceAdjustment(outcome: PatternOutcome): number {
  switch (outcome) {
    case 'success': return CONFIDENCE_BOOST_SUCCESS
    case 'failure': return -CONFIDENCE_PENALTY_FAILURE
    case 'partial': return CONFIDENCE_PARTIAL
  }
}
