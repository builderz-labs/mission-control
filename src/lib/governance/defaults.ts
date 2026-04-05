/**
 * Default Governance Rules
 * WHY: LACP uses a 4-dimension quality gate with specific weights.
 * These defaults match the LACP stop-quality-gate spec:
 * correctness 35%, completeness 30%, style 20%, security 15%.
 * Threshold: 0.625 (= 2.5/4.0 when all weights sum to 1.0).
 */

import type { GateDimension } from './types'

export interface DimensionConfig {
  readonly dimension: GateDimension
  readonly weight: number
  readonly threshold: number
}

export const DEFAULT_GATE_DIMENSIONS: ReadonlyArray<DimensionConfig> = [
  { dimension: 'correctness',  weight: 0.35, threshold: 0.6 },
  { dimension: 'completeness', weight: 0.30, threshold: 0.6 },
  { dimension: 'style',        weight: 0.20, threshold: 0.5 },
  { dimension: 'security',     weight: 0.15, threshold: 0.7 },
] as const

// Weighted pass threshold (LACP spec: 2.5 / 4.0 = 0.625)
export const GATE_PASS_THRESHOLD = 0.625

/**
 * Computes the weighted total score from dimension scores.
 * Uses the configured weights — not equal weighting.
 */
export function computeWeightedScore(
  scores: ReadonlyArray<{ dimension: GateDimension; score: number }>,
  dimensionConfigs: ReadonlyArray<DimensionConfig> = DEFAULT_GATE_DIMENSIONS
): number {
  let total = 0
  let totalWeight = 0

  for (const config of dimensionConfigs) {
    const found = scores.find(s => s.dimension === config.dimension)
    if (found !== undefined) {
      total += found.score * config.weight
      totalWeight += config.weight
    }
  }

  return totalWeight > 0 ? total / totalWeight : 0
}
