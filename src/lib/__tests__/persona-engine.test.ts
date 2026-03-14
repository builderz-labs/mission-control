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
} from '@/lib/persona-engine'
import type { PersonaConfig, MentalState, BigFive } from '@/lib/persona-engine'

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
})
