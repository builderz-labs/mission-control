// All shared interfaces and union types for the self-improving engine.
// Centralised here so each sub-module imports from one place and the public
// API surface stays stable across future refactors.

export interface PerformanceBaseline {
  id: number
  operation_name: string
  baseline_ms: number
  current_avg_ms: number | null
  sample_count: number
  regression_detected: number
  workspace_id: number
  created_at: number
  updated_at: number
}

export interface CostRecord {
  id: number
  agent_id: string
  task_type: string | null
  token_input: number
  token_output: number
  cost_usd: number
  duration_ms: number | null
  quality_score: number | null
  workspace_id: number
  created_at: number
}

export type SuggestionCategory = 'performance' | 'cost' | 'quality' | 'architecture'
export type SuggestionSeverity = 'info' | 'warning' | 'critical'
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'implemented'

export interface ImprovementSuggestion {
  id: number
  category: SuggestionCategory
  severity: SuggestionSeverity
  title: string
  description: string
  evidence: string | null
  status: SuggestionStatus
  workspace_id: number
  created_at: number
  resolved_at: number | null
}

export interface PerformanceDataPoint {
  operation_name: string
  duration_ms: number
  workspace_id?: number
}

export interface CostDataPoint {
  agent_id: string
  task_type?: string
  model_name?: string
  token_input: number
  token_output: number
  duration_ms?: number
  quality_score?: number
  workspace_id?: number
}

export interface ABTestResult {
  task_type: string
  approach_a: string
  approach_b: string
  winner: 'a' | 'b' | 'tie'
  metric: string
  value_a: number
  value_b: number
}

export interface TrendWindow {
  period: 'daily' | 'weekly' | 'monthly'
  metric: string
  values: ReadonlyArray<{ timestamp: number; value: number }>
  trend_direction: 'improving' | 'degrading' | 'stable'
  change_percent: number
}

export interface AgentCostSummary {
  agent_id: string
  total_cost: number
  total_input: number
  total_output: number
  avg_cost: number
  record_count: number
}

export interface TaskTypeCostSummary {
  task_type: string
  total_cost: number
  avg_cost: number
  avg_tokens: number
  record_count: number
}

export interface QualitySummary {
  agent_id: string
  avg_quality: number
  min_quality: number
  max_quality: number
  record_count: number
}

export interface DashboardSummary {
  baselines: ReadonlyArray<PerformanceBaseline>
  regressions: ReadonlyArray<PerformanceBaseline>
  cost_by_agent: ReadonlyArray<AgentCostSummary>
  cost_by_task_type: ReadonlyArray<TaskTypeCostSummary>
  quality_scores: ReadonlyArray<QualitySummary>
  suggestions: ReadonlyArray<ImprovementSuggestion>
  trends: {
    cost: TrendWindow
    performance: TrendWindow
    quality: TrendWindow
  }
}

// Internal shape returned from trend bucket queries
export interface TrendValue {
  timestamp: number
  value: number
}
