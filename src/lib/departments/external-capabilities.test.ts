import { describe, expect, it } from 'vitest'
import { externalCapabilityCandidates } from './external-capabilities'

describe('external capability candidate registry', () => {
  it('never marks experimental optimizers or trainers active by default', () => {
    for (const id of ['gepa', 'evoagentx', 'agent-lightning']) {
      const item = externalCapabilityCandidates.find((candidate) => candidate.id === id)
      expect(item?.adoption_state).toBe('CANDIDATE')
    }
  })

  it('keeps the current local memory integration active and analytics optional', () => {
    expect(externalCapabilityCandidates.find((item) => item.id === 'skillmem')?.adoption_state).toBe('ACTIVE')
    expect(externalCapabilityCandidates.find((item) => item.id === 'umami')?.adoption_state).toBe('CANDIDATE')
    expect(externalCapabilityCandidates.find((item) => item.id === 'promptfoo')?.adoption_state).toBe('CANDIDATE')
    expect(externalCapabilityCandidates.find((item) => item.id === 'memskill')?.adoption_state).toBe('HOLD')
  })
})
