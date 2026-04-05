/**
 * Hill-Climbing Optimizer Types
 * WHY: Trajectory-based A/B comparison for operation configs,
 * adapted from AutoAgent ATIF-v1.6 schema (MIT license).
 * Mirrors the trajectory_comparisons table from migration 051.
 */

export interface TrajectoryComparison {
  readonly id: number
  readonly operation_name: string
  readonly config_a: string
  readonly config_b: string
  readonly metric_name: string
  readonly value_a: number | null
  readonly value_b: number | null
  readonly winner: 'a' | 'b' | 'tie' | null
  readonly confidence: number
  readonly workspace_id: number
  readonly created_at: number
  readonly resolved_at: number | null
}

export interface RecordOutcomeInput {
  readonly comparisonId: number
  readonly variant: 'a' | 'b'
  readonly metricName: string
  readonly value: number
}

export interface ComparisonResult {
  readonly winner: 'a' | 'b' | 'tie'
  readonly confidence: number
  readonly valueA: number | null
  readonly valueB: number | null
  readonly delta: number
}

export interface ProposeVariantOptions {
  readonly mutationRate?: number
  readonly fields?: ReadonlyArray<string>
}
