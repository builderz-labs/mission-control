/**
 * Tests for src/lib/council/scoring.ts
 * WHY: Pure functions — no mocks needed. Covers consensus thresholds,
 * weighted confidence, and round evaluation decision boundaries.
 */
import { describe, it, expect } from 'vitest'
import { computeConsensus, evaluateRound } from '../council/scoring'
import type { Vote } from '../council/types'

function makeVote(id: number, stance: Vote['stance'], confidence = 0.8): Vote {
  return {
    id, deliberationId: 1, agentId: `agent-${id}`, round: 1,
    position: 'position', stance, confidence, workspaceId: 1, createdAt: 0,
  }
}

// ─── computeConsensus ────────────────────────────────────────────────────────

describe('computeConsensus', () => {
  it('returns all zeros when fewer than 3 votes', () => {
    const result = computeConsensus([makeVote(1, 'support'), makeVote(2, 'support')])
    expect(result.weightedConsensus).toBe(0)
    expect(result.canSynthesize).toBe(false)
  })

  it('returns zeros when totalWeight is 0 (confidence = 0 on all votes)', () => {
    const votes = [
      makeVote(1, 'support', 0), makeVote(2, 'support', 0), makeVote(3, 'oppose', 0),
    ]
    const result = computeConsensus(votes)
    expect(result.weightedConsensus).toBe(0)
    expect(result.canSynthesize).toBe(false)
  })

  it('produces weightedConsensus of 1.0 when all votes support at equal confidence', () => {
    const votes = [makeVote(1, 'support'), makeVote(2, 'support'), makeVote(3, 'support')]
    const result = computeConsensus(votes)
    expect(result.weightedConsensus).toBeCloseTo(1.0)
    expect(result.supportRatio).toBeCloseTo(1.0)
    expect(result.opposeRatio).toBeCloseTo(0)
  })

  it('produces weightedConsensus of -1.0 when all votes oppose', () => {
    const votes = [makeVote(1, 'oppose'), makeVote(2, 'oppose'), makeVote(3, 'oppose')]
    const result = computeConsensus(votes)
    expect(result.weightedConsensus).toBeCloseTo(-1.0)
    expect(result.canSynthesize).toBe(true)  // |−1.0| >= 0.6
  })

  it('sets canSynthesize when |weightedConsensus| >= 0.6 (consensus threshold)', () => {
    // 3 support, 1 oppose, equal confidence → consensus = (3-1)/4 = 0.5 < 0.6
    const split = [
      makeVote(1, 'support'), makeVote(2, 'support'),
      makeVote(3, 'support'), makeVote(4, 'oppose'),
    ]
    const belowThreshold = computeConsensus(split)
    expect(belowThreshold.canSynthesize).toBe(false)

    // 4 support, 1 oppose, equal confidence → consensus = (4-1)/5 = 0.6 ≥ 0.6
    const atThreshold = computeConsensus([...split, makeVote(5, 'support')])
    expect(atThreshold.canSynthesize).toBe(true)
  })

  it('neutral and abstain contribute to totalWeight but not to support/oppose', () => {
    const votes = [
      makeVote(1, 'support'), makeVote(2, 'neutral'), makeVote(3, 'abstain'),
    ]
    const result = computeConsensus(votes)
    // supportWeight=0.8, opposeWeight=0, totalWeight=2.4
    expect(result.supportRatio).toBeCloseTo(0.8 / 2.4)
    expect(result.neutralRatio).toBeCloseTo(1.6 / 2.4)
    expect(result.weightedConsensus).toBeCloseTo(0.8 / 2.4)
  })

  it('weights higher-confidence votes more heavily', () => {
    const votes = [
      makeVote(1, 'support', 0.9), makeVote(2, 'support', 0.9), makeVote(3, 'oppose', 0.1),
    ]
    const result = computeConsensus(votes)
    // support = 1.8, oppose = 0.1, total = 1.9 → consensus = 1.7/1.9 ≈ 0.895
    expect(result.weightedConsensus).toBeGreaterThan(0.6)
    expect(result.canSynthesize).toBe(true)
  })
})

// ─── evaluateRound ───────────────────────────────────────────────────────────

describe('evaluateRound', () => {
  it('returns synthesize when consensus clears threshold', () => {
    const votes = [makeVote(1, 'support'), makeVote(2, 'support'), makeVote(3, 'support')]
    expect(evaluateRound(votes, 1)).toBe('synthesize')
  })

  it('returns continue when below threshold and round < 3', () => {
    // Only 2 votes → canSynthesize = false, round 1 < 3
    const votes = [makeVote(1, 'support'), makeVote(2, 'oppose')]
    expect(evaluateRound(votes, 1)).toBe('continue')
  })

  it('returns deadlock when below threshold and round >= 3', () => {
    const votes = [makeVote(1, 'support'), makeVote(2, 'oppose'), makeVote(3, 'neutral')]
    expect(evaluateRound(votes, 3)).toBe('deadlock')
  })

  it('synthesize takes priority over deadlock even at round 5', () => {
    const votes = [makeVote(1, 'support'), makeVote(2, 'support'), makeVote(3, 'support')]
    expect(evaluateRound(votes, 5)).toBe('synthesize')
  })
})
