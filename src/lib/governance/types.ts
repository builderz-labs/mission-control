/**
 * Governance Gate Types
 * WHY: Typed contracts for the LACP-inspired quality gate system
 * ensure scoring dimensions are consistent across all evaluation contexts.
 */

export type GateType = 'pre_deploy' | 'pre_commit' | 'pre_merge' | 'pre_release'
export type GateDimension = 'correctness' | 'completeness' | 'style' | 'security' | 'performance'
export type GateOutcome = 'passed' | 'failed' | 'override'

export interface DimensionScore {
  readonly dimension: GateDimension
  readonly score: number  // 0.0–1.0
  readonly weight: number // relative weight
  readonly notes?: string
}

export interface GateResult {
  readonly id: number
  readonly taskId: number | null
  readonly gateType: GateType
  readonly totalScore: number  // weighted sum
  readonly passed: boolean
  readonly scores: ReadonlyArray<DimensionScore>
  readonly overrideBy: string | null
  readonly workspaceId: number
  readonly evaluatedAt: number
}

export interface EvaluateInput {
  readonly taskId: number | null
  readonly gateType: GateType
  readonly scores: ReadonlyArray<{ dimension: GateDimension; score: number; notes?: string }>
  readonly workspaceId?: number
  readonly overrideBy?: string
}

export interface GovernanceRule {
  readonly id: number
  readonly gateType: GateType
  readonly dimension: GateDimension
  readonly weight: number
  readonly threshold: number
  readonly workspaceId: number
}
