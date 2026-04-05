/**
 * Council Consensus Scoring
 * WHY: Consensus must be computed without mutable state so scoring
 * can be replayed deterministically for audit purposes.
 */

import type { Vote, RoundResult } from './types'

// Minimum consensus ratio to proceed to synthesis (avoid deadlock)
const CONSENSUS_THRESHOLD = 0.6
// Minimum votes before we can evaluate round
const MIN_VOTES_TO_EVALUATE = 3

export interface ConsensusScore {
  readonly supportRatio: number
  readonly opposeRatio: number
  readonly neutralRatio: number
  readonly weightedConsensus: number
  readonly canSynthesize: boolean
}

/**
 * Computes weighted consensus from a set of votes.
 * Confidence weights each vote — a high-confidence support counts more.
 */
export function computeConsensus(votes: ReadonlyArray<Vote>): ConsensusScore {
  if (votes.length < MIN_VOTES_TO_EVALUATE) {
    return { supportRatio: 0, opposeRatio: 0, neutralRatio: 0, weightedConsensus: 0, canSynthesize: false }
  }

  const totalWeight = votes.reduce((sum, v) => sum + v.confidence, 0)
  if (totalWeight === 0) {
    return { supportRatio: 0, opposeRatio: 0, neutralRatio: 0, weightedConsensus: 0, canSynthesize: false }
  }

  const supportWeight = votes
    .filter(v => v.stance === 'support')
    .reduce((sum, v) => sum + v.confidence, 0)

  const opposeWeight = votes
    .filter(v => v.stance === 'oppose')
    .reduce((sum, v) => sum + v.confidence, 0)

  const neutralWeight = votes
    .filter(v => v.stance === 'neutral' || v.stance === 'abstain')
    .reduce((sum, v) => sum + v.confidence, 0)

  const supportRatio = supportWeight / totalWeight
  const opposeRatio = opposeWeight / totalWeight
  const neutralRatio = neutralWeight / totalWeight
  // Weighted consensus: support pulls positive, oppose pulls negative
  const weightedConsensus = (supportWeight - opposeWeight) / totalWeight

  return {
    supportRatio,
    opposeRatio,
    neutralRatio,
    weightedConsensus,
    canSynthesize: Math.abs(weightedConsensus) >= CONSENSUS_THRESHOLD,
  }
}

/**
 * Determines round outcome: continue deliberating, synthesize, or declare deadlock.
 * Deadlock triggers after round 3 with no consensus.
 */
export function evaluateRound(votes: ReadonlyArray<Vote>, currentRound: number): RoundResult {
  const score = computeConsensus(votes)
  if (score.canSynthesize) return 'synthesize'
  if (currentRound >= 3) return 'deadlock'
  return 'continue'
}
