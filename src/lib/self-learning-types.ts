// ---------------------------------------------------------------------------
// Self-Learning — shared types and constants
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

export const DECAY_RATE = 0.05
export const DECAY_INTERVAL_SECONDS = 7 * 24 * 60 * 60 // 7 days
export const MIN_CONFIDENCE = 0.01
export const MAX_CONFIDENCE = 0.99
export const CONFIDENCE_BOOST_SUCCESS = 0.1
export const CONFIDENCE_PENALTY_FAILURE = 0.15
export const CONFIDENCE_PARTIAL = 0.03
export const DEFAULT_LIMIT = 20
export const SUGGESTION_LIMIT = 10
export const RECENT_FEEDBACK_WINDOW_DAYS = 30
