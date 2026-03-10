import { describe, expect, it } from 'vitest'

import { BASE_STEPS, GATEWAY_STEPS, clampWizardStep, getWizardSteps, stepIdAt } from '@/lib/onboarding-flow'

describe('onboarding-flow', () => {
  it('returns base steps when gateway is unavailable', () => {
    const steps = getWizardSteps(false)
    expect(steps).toEqual(BASE_STEPS)
    expect(steps.map((step) => step.id)).toEqual(['welcome', 'interface-mode', 'credentials'])
  })

  it('returns gateway steps when gateway is available', () => {
    const steps = getWizardSteps(true)
    expect(steps).toEqual(GATEWAY_STEPS)
    expect(steps.map((step) => step.id)).toEqual(['welcome', 'interface-mode', 'gateway-link', 'credentials'])
  })

  it('clamps invalid step indexes', () => {
    expect(clampWizardStep(-1, 3)).toBe(0)
    expect(clampWizardStep(0, 3)).toBe(0)
    expect(clampWizardStep(2, 3)).toBe(2)
    expect(clampWizardStep(3, 3)).toBe(2)
  })

  it('returns stable step ids even for out-of-range values', () => {
    const steps = getWizardSteps(false)
    expect(stepIdAt(0, steps)).toBe('welcome')
    expect(stepIdAt(999, steps)).toBe('credentials')
    expect(stepIdAt(-12, steps)).toBe('welcome')
  })
})
