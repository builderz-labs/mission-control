import { describe, expect, it } from 'vitest'

import { BASE_STEPS, GATEWAY_STEPS } from '@/lib/onboarding-flow'
import {
  markStepCompleted,
  nextIncompleteStepIndex,
  parseCompletedSteps,
  shouldShowOnboarding,
} from '@/lib/onboarding-state'

describe('onboarding-state', () => {
  it('parses valid completed steps and removes invalid/duplicates', () => {
    const parsed = parseCompletedSteps(
      JSON.stringify(['welcome', 'welcome', 'gateway-link', 'nope', 1]),
      GATEWAY_STEPS
    )
    expect(parsed).toEqual(['welcome', 'gateway-link'])
  })

  it('returns empty list for malformed JSON', () => {
    expect(parseCompletedSteps('{bad json', BASE_STEPS)).toEqual([])
  })

  it('computes current step index from completed steps', () => {
    expect(nextIncompleteStepIndex(BASE_STEPS, [])).toBe(0)
    expect(nextIncompleteStepIndex(BASE_STEPS, ['welcome'])).toBe(1)
    expect(nextIncompleteStepIndex(BASE_STEPS, ['welcome', 'interface-mode', 'credentials'])).toBe(2)
  })

  it('marks steps complete only when valid and unique', () => {
    const one = markStepCompleted([], 'welcome', BASE_STEPS)
    expect(one).toEqual(['welcome'])

    const same = markStepCompleted(one, 'welcome', BASE_STEPS)
    expect(same).toEqual(['welcome'])

    const invalid = markStepCompleted(one, 'gateway-link', BASE_STEPS)
    expect(invalid).toEqual(['welcome'])
  })

  it('shows onboarding only for admin users when not completed/skipped', () => {
    expect(shouldShowOnboarding({ completed: false, skipped: false, isAdmin: true })).toBe(true)
    expect(shouldShowOnboarding({ completed: true, skipped: false, isAdmin: true })).toBe(false)
    expect(shouldShowOnboarding({ completed: false, skipped: true, isAdmin: true })).toBe(false)
    expect(shouldShowOnboarding({ completed: false, skipped: false, isAdmin: false })).toBe(false)
  })
})
