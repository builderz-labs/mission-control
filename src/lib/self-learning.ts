// ---------------------------------------------------------------------------
// Self-Learning public API — barrel re-export
// Callers import from this file; internal modules import from the sub-modules
// directly to avoid circular dependencies.
// ---------------------------------------------------------------------------

// Types (re-export for external consumers)
export type {
  PatternOutcome,
  LearnedPattern,
  ExecutionTrace,
  FeedbackEntry,
  LearningStats,
  PatternSuggestion,
} from './self-learning-types'

// Pattern management
export {
  recordPattern,
  getPatternById,
  getTopPatterns,
  suggestPatterns,
  findExistingPattern,
  recordOrReinforcePattern,
} from './self-learning-patterns'

// Execution traces
export {
  recordExecutionTrace,
  getSuccessfulTraces,
  findSimilarTraces,
} from './self-learning-traces'

// Decay and feedback
export {
  applyDecay,
  refreshPatternUsage,
  recordFeedback,
  getRecentFeedback,
  markFeedbackApplied,
} from './self-learning-feedback'

// ---------------------------------------------------------------------------
// Skill acquisition and aggregate stats (thin wrappers over sub-modules)
// ---------------------------------------------------------------------------
import { getDatabase } from './db'
import { type LearningStats, RECENT_FEEDBACK_WINDOW_DAYS } from './self-learning-types'
import { suggestPatterns } from './self-learning-patterns'

export function isNovelProblem(
  patternType: string,
  triggerContext: string,
  workspaceId = 1,
): boolean {
  return suggestPatterns(triggerContext, patternType, workspaceId).length === 0
}

export function getNovelProblemCount(workspaceId = 1): number {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM learned_patterns
    WHERE workspace_id = ? AND usage_count <= 1 AND confidence <= 0.5
  `).get(workspaceId) as { count: number }
  return row.count
}

export function getLearningStats(workspaceId = 1): LearningStats {
  const db = getDatabase()

  const patternStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      AVG(confidence) as avg_confidence,
      SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as success_count
    FROM learned_patterns
    WHERE workspace_id = ?
  `).get(workspaceId) as { total: number; avg_confidence: number | null; success_count: number }

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

  const total = patternStats.total || 0

  return {
    totalPatterns: total,
    successRate: Math.round((total > 0 ? patternStats.success_count / total : 0) * 1000) / 1000,
    averageConfidence: Math.round((patternStats.avg_confidence ?? 0) * 1000) / 1000,
    totalTraces: traceCount.count,
    totalFeedback: feedbackStats.total,
    recentFeedbackAvgRating: Math.round((feedbackStats.avg_rating ?? 0) * 100) / 100,
    novelProblemsCount: getNovelProblemCount(workspaceId),
  }
}
