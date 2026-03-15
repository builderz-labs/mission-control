import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockStatement = {
  get: vi.fn(),
  run: vi.fn(),
  all: vi.fn().mockReturnValue([]),
}
const mockDb = { prepare: vi.fn(() => ({ ...mockStatement })) }

vi.mock('@/lib/db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  buildSystemPrompt,
  getPersona,
  getMentalState,
  updateMentalState,
  mergePersonaFragment,
  applyPreset,
  getPresetNames,
  PERSONA_PRESETS,
  getPADState,
  updatePADState,
  decayPADToBaseline,
  padToEmotionLabel,
  getActiveBiases,
  COGNITIVE_BIASES,
  getPairwiseTrust,
  updatePairwiseTrust,
  getAgentTrustNetwork,
  shouldReinjectPersona,
  measureDrift,
  buildReinjectablePrompt,
} from '@/lib/persona-engine'
import type { PersonaConfig, MentalState, BigFive, PADState } from '@/lib/persona-engine'

describe('persona-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatement.get.mockReturnValue(undefined)
    mockStatement.run.mockReturnValue({ changes: 1 })
  })

  describe('buildSystemPrompt', () => {
    it('returns fallback prompt when no content', () => {
      const prompt = buildSystemPrompt({ name: 'Atlas', role: 'engineer' })
      expect(prompt).toContain('Atlas')
      expect(prompt).toContain('engineer')
    })

    it('includes soul_content', () => {
      const prompt = buildSystemPrompt({
        name: 'Atlas',
        role: 'engineer',
        soul_content: '# Atlas\nYou are a diligent software engineer.',
      })
      expect(prompt).toContain('diligent software engineer')
    })

    it('includes persona traits and Big Five', () => {
      const config = {
        persona: {
          personality: {
            traits: ['methodical', 'skeptical'],
            big_five: { openness: 0.6, conscientiousness: 0.9, extraversion: 0.3, agreeableness: 0.5, neuroticism: 0.2 },
          },
          skills: ['debugging', 'testing'],
          style: 'precise and technical',
        } satisfies PersonaConfig,
      }
      const prompt = buildSystemPrompt({ name: 'Atlas', role: 'engineer', config })
      expect(prompt).toContain('methodical')
      expect(prompt).toContain('skeptical')
      expect(prompt).toContain('O=0.6')
      expect(prompt).toContain('C=0.9')
      expect(prompt).toContain('debugging')
      expect(prompt).toContain('precise and technical')
    })

    it('includes mental state when lastUpdated > 0', () => {
      const config = {
        mental_state: {
          emotions: 'focused, slightly stressed',
          goals: 'complete the API refactor',
          attention: 'auth module',
          context: ['sprint deadline tomorrow'],
          lastUpdated: 1000,
        } satisfies MentalState,
      }
      const prompt = buildSystemPrompt({ name: 'Atlas', role: 'engineer', config })
      expect(prompt).toContain('focused, slightly stressed')
      expect(prompt).toContain('complete the API refactor')
      expect(prompt).toContain('auth module')
      expect(prompt).toContain('sprint deadline tomorrow')
    })

    it('excludes mental state when lastUpdated is 0', () => {
      const config = {
        mental_state: {
          emotions: 'neutral',
          goals: 'pending',
          attention: null,
          context: [],
          lastUpdated: 0,
        } satisfies MentalState,
      }
      const prompt = buildSystemPrompt({ name: 'Atlas', role: 'engineer', config })
      expect(prompt).not.toContain('Emotional state')
    })

    it('combines all sections in order', () => {
      const config = {
        persona: {
          personality: { traits: ['logical'], big_five: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 } },
        } satisfies PersonaConfig,
        mental_state: {
          emotions: 'calm',
          goals: 'finish task',
          attention: null,
          context: [],
          lastUpdated: 100,
        } satisfies MentalState,
      }
      const prompt = buildSystemPrompt({
        name: 'Atlas', role: 'engineer',
        soul_content: '# Atlas Soul', config,
      })

      const soulIdx = prompt.indexOf('# Atlas Soul')
      const personaIdx = prompt.indexOf('## Persona')
      const stateIdx = prompt.indexOf('## Current State')

      expect(soulIdx).toBeLessThan(personaIdx)
      expect(personaIdx).toBeLessThan(stateIdx)
    })
  })

  describe('getPersona', () => {
    it('returns null when no config', () => {
      expect(getPersona(null)).toBeNull()
      expect(getPersona(undefined)).toBeNull()
    })

    it('returns null when no persona key', () => {
      expect(getPersona({ other: 'data' })).toBeNull()
    })

    it('returns persona config when present', () => {
      const persona: PersonaConfig = { skills: ['coding'] }
      expect(getPersona({ persona })).toEqual(persona)
    })
  })

  describe('getMentalState', () => {
    it('returns default when no config', () => {
      const state = getMentalState(null)
      expect(state.emotions).toBe('neutral, focused')
      expect(state.lastUpdated).toBe(0)
    })

    it('returns stored mental state', () => {
      const ms: MentalState = {
        emotions: 'excited',
        goals: 'ship the feature',
        attention: 'PR review',
        context: ['new feature ready'],
        lastUpdated: 12345,
      }
      const state = getMentalState({ mental_state: ms })
      expect(state.emotions).toBe('excited')
      expect(state.goals).toBe('ship the feature')
    })
  })

  describe('updateMentalState', () => {
    it('merges cognitive state into existing mental state', () => {
      const existingConfig = JSON.stringify({
        mental_state: {
          emotions: 'calm',
          goals: 'review code',
          attention: 'PR #42',
          context: ['morning standup done'],
          lastUpdated: 100,
        },
      })
      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce({ config: existingConfig }) }
      const runStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare.mockReturnValueOnce(getStmt).mockReturnValueOnce(runStmt)

      updateMentalState(1, { emotions: 'frustrated', attention: 'build failure' }, 1)

      expect(runStmt.run).toHaveBeenCalled()
      const savedConfig = JSON.parse(runStmt.run.mock.calls[0][0])
      expect(savedConfig.mental_state.emotions).toBe('frustrated')
      expect(savedConfig.mental_state.goals).toBe('review code') // preserved
      expect(savedConfig.mental_state.attention).toBe('build failure') // updated
    })

    it('handles agent with no existing config', () => {
      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce({ config: null }) }
      const runStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare.mockReturnValueOnce(getStmt).mockReturnValueOnce(runStmt)

      updateMentalState(1, { emotions: 'happy' }, 1)

      expect(runStmt.run).toHaveBeenCalled()
      const savedConfig = JSON.parse(runStmt.run.mock.calls[0][0])
      expect(savedConfig.mental_state.emotions).toBe('happy')
    })
  })

  describe('mergePersonaFragment', () => {
    it('overlays fragment onto existing persona', () => {
      const existingConfig = JSON.stringify({
        persona: {
          skills: ['coding'],
          personality: {
            traits: ['logical'],
            big_five: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
          },
        },
      })
      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce({ config: existingConfig }) }
      const runStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare.mockReturnValueOnce(getStmt).mockReturnValueOnce(runStmt)

      mergePersonaFragment(1, { skills: ['coding', 'debugging'], style: 'concise' }, 1)

      const savedConfig = JSON.parse(runStmt.run.mock.calls[0][0])
      expect(savedConfig.persona.skills).toEqual(['coding', 'debugging'])
      expect(savedConfig.persona.style).toBe('concise')
      // Personality preserved from existing
      expect(savedConfig.persona.personality.traits).toEqual(['logical'])
    })

    it('deep merges Big Five values', () => {
      const existingConfig = JSON.stringify({
        persona: {
          personality: {
            traits: ['careful'],
            big_five: { openness: 0.3, conscientiousness: 0.8, extraversion: 0.4, agreeableness: 0.6, neuroticism: 0.5 },
          },
        },
      })
      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce({ config: existingConfig }) }
      const runStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare.mockReturnValueOnce(getStmt).mockReturnValueOnce(runStmt)

      mergePersonaFragment(1, {
        personality: {
          traits: ['careful', 'precise'],
          big_five: { openness: 0.7 } as BigFive,
        },
      }, 1)

      const savedConfig = JSON.parse(runStmt.run.mock.calls[0][0])
      expect(savedConfig.persona.personality.big_five.openness).toBe(0.7) // updated
      expect(savedConfig.persona.personality.big_five.conscientiousness).toBe(0.8) // preserved
      expect(savedConfig.persona.personality.traits).toEqual(['careful', 'precise'])
    })
  })

  describe('presets', () => {
    it('has all expected presets', () => {
      const names = getPresetNames()
      expect(names).toContain('analytical-engineer')
      expect(names).toContain('creative-designer')
      expect(names).toContain('cautious-reviewer')
      expect(names).toContain('team-lead')
    })

    it('each preset has valid Big Five values (0-1)', () => {
      for (const [name, preset] of Object.entries(PERSONA_PRESETS)) {
        if (preset.personality?.big_five) {
          for (const [trait, value] of Object.entries(preset.personality.big_five)) {
            expect(value, `${name}.${trait}`).toBeGreaterThanOrEqual(0)
            expect(value, `${name}.${trait}`).toBeLessThanOrEqual(1)
          }
        }
      }
    })

    it('applyPreset returns false for unknown preset', () => {
      expect(applyPreset(1, 'nonexistent-preset', 1)).toBe(false)
    })

    it('applyPreset delegates to mergePersonaFragment', () => {
      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce({ config: '{}' }) }
      const runStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare.mockReturnValueOnce(getStmt).mockReturnValueOnce(runStmt)

      const result = applyPreset(1, 'analytical-engineer', 1)
      expect(result).toBe(true)
      expect(runStmt.run).toHaveBeenCalled()
    })
  })

  describe('getPADState', () => {
    it('returns default neutral state when no config', () => {
      const pad = getPADState(null)
      expect(pad.pleasure).toBe(0)
      expect(pad.arousal).toBe(0)
      expect(pad.dominance).toBe(0)
      expect(pad.updated_at).toBe(0)
    })

    it('returns default when config has no pad_state', () => {
      const pad = getPADState({ other: 'data' })
      expect(pad.pleasure).toBe(0)
    })

    it('returns stored PAD state', () => {
      const stored = { pleasure: 0.5, arousal: -0.3, dominance: 0.7, updated_at: 1000 }
      const pad = getPADState({ pad_state: stored })
      expect(pad.pleasure).toBe(0.5)
      expect(pad.arousal).toBe(-0.3)
      expect(pad.dominance).toBe(0.7)
      expect(pad.updated_at).toBe(1000)
    })
  })

  describe('updatePADState', () => {
    it('updates PAD and stores in config', () => {
      const existingConfig = JSON.stringify({ pad_state: { pleasure: 0, arousal: 0, dominance: 0, updated_at: 100 } })
      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce({ config: existingConfig }) }
      const runStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare.mockReturnValueOnce(getStmt).mockReturnValueOnce(runStmt)

      updatePADState(1, { pleasure: 0.8 }, 1)

      expect(runStmt.run).toHaveBeenCalled()
      const savedConfig = JSON.parse(runStmt.run.mock.calls[0][0])
      expect(savedConfig.pad_state.pleasure).toBe(0.8)
    })

    it('clamps PAD values to [-1, 1]', () => {
      const existingConfig = JSON.stringify({})
      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValueOnce({ config: existingConfig }) }
      const runStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare.mockReturnValueOnce(getStmt).mockReturnValueOnce(runStmt)

      updatePADState(1, { pleasure: 2.5, arousal: -3 }, 1)

      const savedConfig = JSON.parse(runStmt.run.mock.calls[0][0])
      expect(savedConfig.pad_state.pleasure).toBe(1)
      expect(savedConfig.pad_state.arousal).toBe(-1)
    })
  })

  describe('decayPADToBaseline', () => {
    it('returns same values when elapsedMs is 0', () => {
      const pad: PADState = { pleasure: 0.8, arousal: -0.5, dominance: 0.3, updated_at: 100 }
      const bf: BigFive = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 }
      const result = decayPADToBaseline(pad, bf, 0)
      expect(result.pleasure).toBe(0.8)
      expect(result.arousal).toBe(-0.5)
      expect(result.dominance).toBe(0.3)
    })

    it('decays toward baseline over time', () => {
      const pad: PADState = { pleasure: 1, arousal: 1, dominance: 1, updated_at: 100 }
      // agreeableness=0.5 → baseline pleasure=0, extraversion=0.5 → baseline arousal=0, neuroticism=0.5 → baseline dom=0
      const bf: BigFive = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 }
      const result = decayPADToBaseline(pad, bf, 1800000) // 1 half-life
      // After 1 half-life, should decay ~50% toward baseline (0)
      expect(result.pleasure).toBeLessThan(1)
      expect(result.pleasure).toBeGreaterThan(0)
      expect(result.pleasure).toBeCloseTo(0.5, 0) // rough check
    })

    it('converges to baseline after long elapsed time', () => {
      const pad: PADState = { pleasure: 1, arousal: -1, dominance: 0.5, updated_at: 100 }
      const bf: BigFive = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 }
      const result = decayPADToBaseline(pad, bf, 1800000 * 10) // 10 half-lives
      expect(result.pleasure).toBeCloseTo(0, 1)
      expect(result.arousal).toBeCloseTo(0, 1)
      expect(result.dominance).toBeCloseTo(0, 1)
    })

    it('maps Big Five to correct baselines', () => {
      const pad: PADState = { pleasure: 0, arousal: 0, dominance: 0, updated_at: 100 }
      // agreeableness=1 → pleasure baseline=1, extraversion=1 → arousal baseline=1, neuroticism=0 → dom baseline=1
      const bf: BigFive = { openness: 0.5, conscientiousness: 0.5, extraversion: 1.0, agreeableness: 1.0, neuroticism: 0.0 }
      const result = decayPADToBaseline(pad, bf, 1800000 * 10) // long time
      expect(result.pleasure).toBeCloseTo(1, 1)
      expect(result.arousal).toBeCloseTo(1, 1)
      expect(result.dominance).toBeCloseTo(1, 1)
    })
  })

  describe('padToEmotionLabel', () => {
    it('maps all 8 octants correctly', () => {
      expect(padToEmotionLabel({ pleasure: 0.5, arousal: 0.5, dominance: 0.5, updated_at: 0 })).toBe('exuberant')
      expect(padToEmotionLabel({ pleasure: 0.5, arousal: 0.5, dominance: -0.5, updated_at: 0 })).toBe('dependent')
      expect(padToEmotionLabel({ pleasure: 0.5, arousal: -0.5, dominance: 0.5, updated_at: 0 })).toBe('relaxed')
      expect(padToEmotionLabel({ pleasure: 0.5, arousal: -0.5, dominance: -0.5, updated_at: 0 })).toBe('docile')
      expect(padToEmotionLabel({ pleasure: -0.5, arousal: 0.5, dominance: 0.5, updated_at: 0 })).toBe('hostile')
      expect(padToEmotionLabel({ pleasure: -0.5, arousal: 0.5, dominance: -0.5, updated_at: 0 })).toBe('anxious')
      expect(padToEmotionLabel({ pleasure: -0.5, arousal: -0.5, dominance: 0.5, updated_at: 0 })).toBe('disdainful')
      expect(padToEmotionLabel({ pleasure: -0.5, arousal: -0.5, dominance: -0.5, updated_at: 0 })).toBe('bored')
    })

    it('handles zero values (positive octant)', () => {
      expect(padToEmotionLabel({ pleasure: 0, arousal: 0, dominance: 0, updated_at: 0 })).toBe('exuberant')
    })
  })

  describe('getActiveBiases', () => {
    it('returns empty for neutral Big Five', () => {
      const bf: BigFive = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 }
      expect(getActiveBiases(bf)).toEqual([])
    })

    it('activates Confirmation Bias for low openness', () => {
      const bf: BigFive = { openness: 0.2, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 }
      const biases = getActiveBiases(bf)
      expect(biases.some(b => b.name === 'Confirmation Bias')).toBe(true)
    })

    it('activates Anchoring for high conscientiousness', () => {
      const bf: BigFive = { openness: 0.5, conscientiousness: 0.8, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 }
      const biases = getActiveBiases(bf)
      expect(biases.some(b => b.name === 'Anchoring')).toBe(true)
    })

    it('activates Availability Heuristic for high neuroticism', () => {
      const bf: BigFive = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.7 }
      const biases = getActiveBiases(bf)
      expect(biases.some(b => b.name === 'Availability Heuristic')).toBe(true)
    })

    it('activates Sunk Cost for low openness + high conscientiousness', () => {
      const bf: BigFive = { openness: 0.2, conscientiousness: 0.8, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 }
      const biases = getActiveBiases(bf)
      expect(biases.some(b => b.name === 'Sunk Cost')).toBe(true)
    })

    it('activates Bandwagon for high agreeableness + high extraversion', () => {
      const bf: BigFive = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.7, agreeableness: 0.8, neuroticism: 0.5 }
      const biases = getActiveBiases(bf)
      expect(biases.some(b => b.name === 'Bandwagon Effect')).toBe(true)
    })

    it('activates Dunning-Kruger for low openness + high extraversion', () => {
      const bf: BigFive = { openness: 0.2, conscientiousness: 0.5, extraversion: 0.7, agreeableness: 0.5, neuroticism: 0.5 }
      const biases = getActiveBiases(bf)
      expect(biases.some(b => b.name === 'Dunning-Kruger')).toBe(true)
    })

    it('activates Status Quo for low openness + high neuroticism', () => {
      const bf: BigFive = { openness: 0.2, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.6 }
      const biases = getActiveBiases(bf)
      expect(biases.some(b => b.name === 'Status Quo Bias')).toBe(true)
    })

    it('activates Recency for high neuroticism + low conscientiousness', () => {
      const bf: BigFive = { openness: 0.5, conscientiousness: 0.3, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.7 }
      const biases = getActiveBiases(bf)
      expect(biases.some(b => b.name === 'Recency Bias')).toBe(true)
    })

    it('activates multiple biases for extreme profile', () => {
      const bf: BigFive = { openness: 0.1, conscientiousness: 0.9, extraversion: 0.8, agreeableness: 0.8, neuroticism: 0.8 }
      const biases = getActiveBiases(bf)
      expect(biases.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('COGNITIVE_BIASES catalog', () => {
    it('has 8 biases', () => {
      expect(COGNITIVE_BIASES).toHaveLength(8)
    })

    it('each bias has required fields', () => {
      for (const bias of COGNITIVE_BIASES) {
        expect(bias.name).toBeTruthy()
        expect(bias.description).toBeTruthy()
        expect(typeof bias.activationCheck).toBe('function')
        expect(bias.promptFragment).toBeTruthy()
      }
    })
  })

  describe('buildSystemPrompt with PAD + biases', () => {
    it('includes PAD section when pad_state has updated_at > 0', () => {
      const config = {
        pad_state: { pleasure: 0.5, arousal: -0.3, dominance: 0.7, updated_at: Math.floor(Date.now() / 1000) },
      }
      const prompt = buildSystemPrompt({ name: 'Atlas', role: 'engineer', config })
      expect(prompt).toContain('Emotional State')
      expect(prompt).toContain('PAD vector')
    })

    it('excludes PAD section when updated_at is 0', () => {
      const config = {
        pad_state: { pleasure: 0.5, arousal: -0.3, dominance: 0.7, updated_at: 0 },
      }
      const prompt = buildSystemPrompt({ name: 'Atlas', role: 'engineer', config })
      expect(prompt).not.toContain('Emotional State')
    })

    it('includes active biases in prompt for biased profile', () => {
      const config = {
        persona: {
          personality: {
            traits: ['rigid'],
            big_five: { openness: 0.2, conscientiousness: 0.8, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
          },
        } satisfies PersonaConfig,
      }
      const prompt = buildSystemPrompt({ name: 'Atlas', role: 'engineer', config })
      expect(prompt).toContain('Cognitive Biases')
      expect(prompt).toContain('Confirmation Bias')
      expect(prompt).toContain('Anchoring')
    })

    it('excludes bias section for neutral profile', () => {
      const config = {
        persona: {
          personality: {
            traits: ['balanced'],
            big_five: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
          },
        } satisfies PersonaConfig,
      }
      const prompt = buildSystemPrompt({ name: 'Atlas', role: 'engineer', config })
      expect(prompt).not.toContain('Cognitive Biases')
    })
  })

  describe('getPairwiseTrust', () => {
    it('returns default 0.5 for unknown pair', () => {
      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValue(undefined) }
      mockDb.prepare.mockReturnValueOnce(getStmt)

      const trust = getPairwiseTrust(mockDb as never, 1, 2)
      expect(trust.trust_score).toBe(0.5)
      expect(trust.interaction_count).toBe(0)
      expect(trust.last_interaction_at).toBeNull()
    })
  })

  describe('updatePairwiseTrust', () => {
    it('clamps to 0-1 range (lower bound)', () => {
      // First call: getPairwiseTrust's prepare().get() returns current score of 0.1
      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValue({ trust_score: 0.1, interaction_count: 1, last_interaction_at: 100 }) }
      // Second call: the INSERT/UPSERT prepare().run()
      const runStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare.mockReturnValueOnce(getStmt).mockReturnValueOnce(runStmt)

      const result = updatePairwiseTrust(mockDb as never, 1, 2, -0.5)
      expect(result).toBe(0) // clamped: 0.1 + (-0.5) = -0.4 -> 0
    })

    it('clamps to 0-1 range (upper bound)', () => {
      const getStmt = { ...mockStatement, get: vi.fn().mockReturnValue({ trust_score: 0.9, interaction_count: 5, last_interaction_at: 200 }) }
      const runStmt = { ...mockStatement, run: vi.fn() }
      mockDb.prepare.mockReturnValueOnce(getStmt).mockReturnValueOnce(runStmt)

      const result = updatePairwiseTrust(mockDb as never, 1, 2, 0.5)
      expect(result).toBe(1) // clamped: 0.9 + 0.5 = 1.4 -> 1
    })
  })

  describe('getAgentTrustNetwork', () => {
    it('returns empty array for unknown agent', () => {
      const allStmt = { ...mockStatement, all: vi.fn().mockReturnValue([]) }
      mockDb.prepare.mockReturnValueOnce(allStmt)

      const network = getAgentTrustNetwork(mockDb as never, 999)
      expect(network).toEqual([])
    })
  })

  describe('shouldReinjectPersona', () => {
    it('returns true on multiples of interval', () => {
      expect(shouldReinjectPersona(5)).toBe(true)
      expect(shouldReinjectPersona(10)).toBe(true)
      expect(shouldReinjectPersona(15)).toBe(true)
      expect(shouldReinjectPersona(6, 3)).toBe(true)
    })

    it('returns false on non-multiples', () => {
      expect(shouldReinjectPersona(0)).toBe(false)
      expect(shouldReinjectPersona(1)).toBe(false)
      expect(shouldReinjectPersona(3)).toBe(false)
      expect(shouldReinjectPersona(7)).toBe(false)
    })
  })

  describe('measureDrift', () => {
    it('returns 0 for identical BigFive', () => {
      const bf: BigFive = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 }
      expect(measureDrift(bf, bf)).toBe(0)
    })

    it('returns positive for different BigFive', () => {
      const original: BigFive = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 }
      const drifted: BigFive = { openness: 0.8, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 }
      const drift = measureDrift(original, drifted)
      expect(drift).toBeGreaterThan(0)
      expect(drift).toBeCloseTo(0.3, 5)
    })
  })

  describe('buildReinjectablePrompt', () => {
    const agentWithPersona = {
      name: 'Atlas',
      role: 'engineer',
      config: {
        persona: {
          personality: {
            traits: ['methodical'],
            big_five: { openness: 0.6, conscientiousness: 0.9, extraversion: 0.3, agreeableness: 0.5, neuroticism: 0.2 },
          },
        } satisfies PersonaConfig,
      },
    }

    it('includes reinforcement header on trigger turns', () => {
      const prompt = buildReinjectablePrompt(agentWithPersona, 5)
      expect(prompt).toContain('[PERSONA REINFORCEMENT')
      expect(prompt).toContain('Turn 5')
      expect(prompt).toContain('O=0.6')
      expect(prompt).toContain('C=0.9')
    })

    it('returns base prompt on non-trigger turns', () => {
      const prompt = buildReinjectablePrompt(agentWithPersona, 3)
      expect(prompt).not.toContain('[PERSONA REINFORCEMENT')
      // Should still have persona content from buildSystemPrompt
      expect(prompt).toContain('methodical')
    })
  })
})
