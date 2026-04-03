import { getDatabase } from './db'
import { logger } from './logger'

// ---------------------------------------------------------------------------
// Types (immutable interfaces)
// ---------------------------------------------------------------------------

export type PatternOutcome = 'success' | 'failure' | 'partial'

export interface LearnedPattern {
  readonly id: number
  readonly pattern_type: string
  readonly trigger_context: string
  readonly action_taken: string
  readonly outcome: PatternOutcome
  readonly confidence: number
  readonly usage_count: number
  readonly last_used_at: number | null
  readonly decay_factor: number
  readonly workspace_id: number
  readonly created_at: number
  readonly updated_at: number
}

export interface ExecutionTrace {
  readonly id: number
  readonly task_id: number | null
  readonly agent_id: string | null
  readonly action_sequence: string
  readonly input_context: string
  readonly output_result: string
  readonly duration_ms: number
  readonly token_cost: number
  readonly success: number
  readonly workspace_id: number
  readonly created_at: number
}

export interface FeedbackEntry {
  readonly id: number
  readonly task_id: number | null
  readonly pattern_id: number | null
  readonly rating: number
  readonly correction: string | null
  readonly applied: number
  readonly workspace_id: number
  readonly created_at: number
}

export interface LearningStats {
  readonly totalPatterns: number
  readonly successRate: number
  readonly averageConfidence: number
  readonly totalTraces: number
  readonly totalFeedback: number
  readonly recentFeedbackAvgRating: number
  readonly novelProblemsCount: number
}

export interface PatternSuggestion {
  readonly pattern: LearnedPattern
  readonly relevanceScore: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DECAY_RATE = 0.05
const DECAY_INTERVAL_SECONDS = 7 * 24 * 60 * 60 // 7 days
const MIN_CONFIDENCE = 0.01
const MAX_CONFIDENCE = 0.99
const CONFIDENCE_BOOST_SUCCESS = 0.1
const CONFIDENCE_PENALTY_FAILURE = 0.15
const CONFIDENCE_PARTIAL = 0.03
const DEFAULT_LIMIT = 20
const SUGGESTION_LIMIT = 10
const RECENT_FEEDBACK_WINDOW_DAYS = 30

// ---------------------------------------------------------------------------
// Pattern Extraction
// ---------------------------------------------------------------------------

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
    input.patternType,
    input.triggerContext,
    input.actionTaken,
    input.outcome,
    initialConfidence,
    now,
    workspaceId,
    now,
    now,
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

export function getPatternById(
  id: number,
  workspaceId: number = 1,
): LearnedPattern | null {
  const db = getDatabase()
  const row = db.prepare(
    'SELECT id, pattern_type, trigger_context, action_taken, outcome, confidence, usage_count, last_used_at, decay_factor, workspace_id, created_at, updated_at FROM learned_patterns WHERE id = ? AND workspace_id = ?',
  ).get(id, workspaceId) as LearnedPattern | undefined

  return row ?? null
}

export function getTopPatterns(
  workspaceId: number = 1,
  limit: number = DEFAULT_LIMIT,
): readonly LearnedPattern[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT id, pattern_type, trigger_context, action_taken, outcome, confidence, usage_count, last_used_at, decay_factor, workspace_id, created_at, updated_at
    FROM learned_patterns
    WHERE workspace_id = ? AND confidence * decay_factor > ?
    ORDER BY (confidence * decay_factor * usage_count) DESC
    LIMIT ?
  `).all(workspaceId, MIN_CONFIDENCE, limit) as LearnedPattern[]
}

// ---------------------------------------------------------------------------
// Pattern Suggestion (auto-suggest for similar tasks)
// ---------------------------------------------------------------------------

export function suggestPatterns(
  triggerContext: string,
  patternType: string,
  workspaceId: number = 1,
): readonly PatternSuggestion[] {
  const db = getDatabase()

  const candidates = db.prepare(`
    SELECT id, pattern_type, trigger_context, action_taken, outcome, confidence, usage_count, last_used_at, decay_factor, workspace_id, created_at, updated_at
    FROM learned_patterns
    WHERE workspace_id = ? AND pattern_type = ? AND confidence * decay_factor > ?
    ORDER BY confidence DESC
    LIMIT ?
  `).all(workspaceId, patternType, MIN_CONFIDENCE, SUGGESTION_LIMIT * 3) as LearnedPattern[]

  const keywords = extractKeywords(triggerContext)

  const scored = candidates.map((pattern) => {
    const relevanceScore = computeRelevance(pattern, keywords)
    return { pattern, relevanceScore } as const
  })

  return scored
    .filter((s) => s.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, SUGGESTION_LIMIT)
}

function extractKeywords(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[\s,.:;!?'"()\[\]{}|/\\]+/)
    .filter((word) => word.length > 2)
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
// Experience Replay
// ---------------------------------------------------------------------------

interface RecordTraceInput {
  readonly taskId?: number
  readonly agentId?: string
  readonly actionSequence: string
  readonly inputContext: string
  readonly outputResult: string
  readonly durationMs: number
  readonly tokenCost?: number
  readonly success: boolean
  readonly workspaceId?: number
}

export function recordExecutionTrace(input: RecordTraceInput): ExecutionTrace {
  const db = getDatabase()
  const workspaceId = input.workspaceId ?? 1

  const result = db.prepare(`
    INSERT INTO execution_traces
      (task_id, agent_id, action_sequence, input_context, output_result, duration_ms, token_cost, success, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.taskId ?? null,
    input.agentId ?? null,
    input.actionSequence,
    input.inputContext,
    input.outputResult,
    input.durationMs,
    input.tokenCost ?? 0,
    input.success ? 1 : 0,
    workspaceId,
  )

  logger.info(
    { taskId: input.taskId, success: input.success },
    'Recorded execution trace',
  )

  return getTraceById(Number(result.lastInsertRowid), workspaceId)!
}

function getTraceById(
  id: number,
  workspaceId: number = 1,
): ExecutionTrace | null {
  const db = getDatabase()
  const row = db.prepare(
    'SELECT id, task_id, agent_id, action_sequence, input_context, output_result, duration_ms, token_cost, success, workspace_id, created_at FROM execution_traces WHERE id = ? AND workspace_id = ?',
  ).get(id, workspaceId) as ExecutionTrace | undefined

  return row ?? null
}

export function getSuccessfulTraces(
  workspaceId: number = 1,
  limit: number = DEFAULT_LIMIT,
): readonly ExecutionTrace[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT id, task_id, agent_id, action_sequence, input_context, output_result, duration_ms, token_cost, success, workspace_id, created_at
    FROM execution_traces
    WHERE workspace_id = ? AND success = 1
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspaceId, limit) as ExecutionTrace[]
}

export function findSimilarTraces(
  inputContext: string,
  workspaceId: number = 1,
  limit: number = 5,
): readonly ExecutionTrace[] {
  const db = getDatabase()
  const keywords = extractKeywords(inputContext)
  if (keywords.length === 0) return []

  // Retrieve recent successful traces and rank by keyword overlap
  const candidates = db.prepare(`
    SELECT id, task_id, agent_id, action_sequence, input_context, output_result, duration_ms, token_cost, success, workspace_id, created_at
    FROM execution_traces
    WHERE workspace_id = ? AND success = 1
    ORDER BY created_at DESC
    LIMIT 100
  `).all(workspaceId) as ExecutionTrace[]

  return candidates
    .map((trace) => {
      const traceWords = extractKeywords(trace.input_context)
      const overlap = keywords.filter((kw) => traceWords.includes(kw)).length
      return { trace, overlap }
    })
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, limit)
    .map((entry) => entry.trace)
}

// ---------------------------------------------------------------------------
// Decay Engine
// ---------------------------------------------------------------------------

export function applyDecay(workspaceId: number = 1): number {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now - DECAY_INTERVAL_SECONDS

  const result = db.prepare(`
    UPDATE learned_patterns
    SET decay_factor = MAX(?, decay_factor - ?),
        updated_at = ?
    WHERE workspace_id = ? AND last_used_at < ? AND decay_factor > ?
  `).run(MIN_CONFIDENCE, DECAY_RATE, now, workspaceId, cutoff, MIN_CONFIDENCE)

  const decayed = result.changes
  if (decayed > 0) {
    logger.info({ decayed, workspaceId }, 'Applied pattern decay')
  }
  return decayed
}

export function refreshPatternUsage(
  patternId: number,
  workspaceId: number = 1,
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
// Feedback Integration
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

  // If feedback references a pattern, update its confidence immediately
  if (input.patternId != null) {
    updatePatternFromFeedback(input.patternId, input.rating, workspaceId)
  }

  logger.info(
    { patternId: input.patternId, rating: input.rating },
    'Recorded feedback entry',
  )

  return getFeedbackById(Number(result.lastInsertRowid), workspaceId)!
}

function getFeedbackById(
  id: number,
  workspaceId: number = 1,
): FeedbackEntry | null {
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
  workspaceId: number = 1,
  limit: number = DEFAULT_LIMIT,
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
  workspaceId: number = 1,
): FeedbackEntry | null {
  const db = getDatabase()
  db.prepare(`
    UPDATE feedback_entries SET applied = 1
    WHERE id = ? AND workspace_id = ?
  `).run(feedbackId, workspaceId)

  return getFeedbackById(feedbackId, workspaceId)
}

// ---------------------------------------------------------------------------
// Skill Acquisition (novel problem detection)
// ---------------------------------------------------------------------------

export function isNovelProblem(
  patternType: string,
  triggerContext: string,
  workspaceId: number = 1,
): boolean {
  const suggestions = suggestPatterns(triggerContext, patternType, workspaceId)
  return suggestions.length === 0
}

export function getNovelProblemCount(workspaceId: number = 1): number {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM learned_patterns
    WHERE workspace_id = ? AND usage_count <= 1 AND confidence <= 0.5
  `).get(workspaceId) as { count: number }

  return row.count
}

// ---------------------------------------------------------------------------
// Learning Stats
// ---------------------------------------------------------------------------

export function getLearningStats(workspaceId: number = 1): LearningStats {
  const db = getDatabase()

  const patternStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      AVG(confidence) as avg_confidence,
      SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as success_count
    FROM learned_patterns
    WHERE workspace_id = ?
  `).get(workspaceId) as {
    total: number
    avg_confidence: number | null
    success_count: number
  }

  const traceCount = db.prepare(
    'SELECT COUNT(*) as count FROM execution_traces WHERE workspace_id = ?',
  ).get(workspaceId) as { count: number }

  const feedbackStats = db.prepare(`
    SELECT COUNT(*) as total, AVG(rating) as avg_rating
    FROM feedback_entries
    WHERE workspace_id = ? AND created_at > ?
  `).get(
    workspaceId,
    Math.floor(Date.now() / 1000) - RECENT_FEEDBACK_WINDOW_DAYS * 86400,
  ) as { total: number; avg_rating: number | null }

  const novelCount = getNovelProblemCount(workspaceId)

  const total = patternStats.total || 0
  const successRate = total > 0
    ? patternStats.success_count / total
    : 0

  return {
    totalPatterns: total,
    successRate: Math.round(successRate * 1000) / 1000,
    averageConfidence: Math.round((patternStats.avg_confidence ?? 0) * 1000) / 1000,
    totalTraces: traceCount.count,
    totalFeedback: feedbackStats.total,
    recentFeedbackAvgRating: Math.round((feedbackStats.avg_rating ?? 0) * 100) / 100,
    novelProblemsCount: novelCount,
  }
}

// ---------------------------------------------------------------------------
// Duplicate Pattern Prevention
// ---------------------------------------------------------------------------

export function findExistingPattern(
  patternType: string,
  actionTaken: string,
  workspaceId: number = 1,
): LearnedPattern | null {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT id, pattern_type, trigger_context, action_taken, outcome, confidence, usage_count, last_used_at, decay_factor, workspace_id, created_at, updated_at
    FROM learned_patterns
    WHERE workspace_id = ? AND pattern_type = ? AND action_taken = ?
    ORDER BY confidence DESC
    LIMIT 1
  `).get(workspaceId, patternType, actionTaken) as LearnedPattern | undefined

  return row ?? null
}

export function recordOrReinforcePattern(
  input: RecordPatternInput,
): LearnedPattern {
  const existing = findExistingPattern(
    input.patternType,
    input.actionTaken,
    input.workspaceId ?? 1,
  )

  if (existing) {
    const reinforced = reinforceExistingPattern(existing, input.outcome)
    return reinforced ?? existing
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
    SET confidence = ?,
        outcome = ?,
        usage_count = usage_count + 1,
        last_used_at = ?,
        decay_factor = MIN(1.0, decay_factor + ?),
        updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `).run(
    newConfidence,
    outcome,
    now,
    DECAY_RATE,
    now,
    pattern.id,
    pattern.workspace_id,
  )

  return getPatternById(pattern.id, pattern.workspace_id)
}

function outcomeToConfidenceAdjustment(outcome: PatternOutcome): number {
  switch (outcome) {
    case 'success': return CONFIDENCE_BOOST_SUCCESS
    case 'failure': return -CONFIDENCE_PENALTY_FAILURE
    case 'partial': return CONFIDENCE_PARTIAL
  }
}
