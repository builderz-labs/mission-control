import { describe, expect, it } from 'vitest'
import {
  PORTFOLIO_EXPLORATION_POLICY,
  evaluateOpportunityEvidenceGate,
} from './model'

describe('revenue opportunity model', () => {
  it('requires independent evidence before an opportunity can advance', () => {
    const result = evaluateOpportunityEvidenceGate({
      unique_sources: 2,
      repeated_user_pain: true,
      existing_alternative_verified: true,
      existing_spend_or_loss_verified: false,
      frequency_verified: true,
      competition_checked: true,
      distribution_path_verified: true,
    })
    expect(result.pass).toBe(false)
    expect(result.missing).toContain('unique_sources>=3')
    expect(result.missing).toContain('existing_spend_or_loss_verified')
  })

  it('passes only when the full minimum evidence gate is satisfied', () => {
    const result = evaluateOpportunityEvidenceGate({
      unique_sources: 3,
      repeated_user_pain: true,
      existing_alternative_verified: true,
      existing_spend_or_loss_verified: true,
      frequency_verified: true,
      competition_checked: true,
      distribution_path_verified: true,
    })
    expect(result).toEqual({ pass: true, missing: [] })
  })

  it('keeps exploration portfolio diversified', () => {
    const total = Object.values(PORTFOLIO_EXPLORATION_POLICY).reduce((sum, value) => sum + value, 0)
    expect(total).toBeCloseTo(1)
    expect(PORTFOLIO_EXPLORATION_POLICY.HIGH_ECONOMIC_GRAVITY).toBe(0.5)
    expect(PORTFOLIO_EXPLORATION_POLICY.EXPLORATION).toBe(0.2)
  })
})
