import { describe, expect, it } from 'vitest'
import { getAgentVisuals, getAllKnownAgentNames } from '@/lib/agent-visuals'
import type { AgentVisualConfig } from '@/lib/agent-visuals'

function isValidHex(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color)
}

describe('agent-visuals', () => {
  describe('getAgentVisuals', () => {
    it('returns config for known agent by exact lowercase name', () => {
      const config = getAgentVisuals('watson')
      expect(config.displayName).toBe('Watson')
      expect(config.color).toBe('#b4befe')
      expect(config.initials).toBeTruthy()
      expect(config.bgClass).toContain('bg-')
      expect(config.borderClass).toContain('border-')
      expect(config.spriteFilter).toBeTruthy()
      expect(config.deskStyle).toBeTruthy()
      expect(Array.isArray(config.deskProps)).toBe(true)
    })

    it('normalizes mixed-case names', () => {
      const upper = getAgentVisuals('Watson')
      const lower = getAgentVisuals('watson')
      expect(upper).toEqual(lower)
    })

    it('normalizes spaces to hyphens', () => {
      const spaced = getAgentVisuals('Knowing Gnome')
      const hyphenated = getAgentVisuals('knowing-gnome')
      expect(spaced).toEqual(hyphenated)
      expect(spaced.color).toBe('#f9e2af')
    })

    it('normalizes underscores to hyphens', () => {
      const underscored = getAgentVisuals('knowing_gnome')
      const hyphenated = getAgentVisuals('knowing-gnome')
      expect(underscored).toEqual(hyphenated)
    })

    it('returns fallback for unknown agents without crashing', () => {
      const config = getAgentVisuals('totally-unknown-agent')
      expect(config).toBeDefined()
      expect(config.displayName).toBe('totally-unknown-agent')
      expect(isValidHex(config.color)).toBe(true)
      expect(config.bgClass).toContain('bg-')
      expect(config.borderClass).toContain('border-')
      expect(config.spriteFilter).toBeTruthy()
      expect(config.deskStyle).toBeTruthy()
      expect(Array.isArray(config.deskProps)).toBe(true)
    })

    it('returns fallback for empty string', () => {
      const config = getAgentVisuals('')
      expect(config).toBeDefined()
      expect(isValidHex(config.color)).toBe(true)
      expect(config.initials).toBeTruthy()
    })

    it('is safe against prototype pollution keys', () => {
      const config = getAgentVisuals('__proto__')
      expect(config).toBeDefined()
      expect(isValidHex(config.color)).toBe(true)
      // Should return fallback, not Object.prototype
      expect(config.displayName).toBe('__proto__')
    })
  })

  describe('getAllKnownAgentNames', () => {
    it('returns all 9 known agents', () => {
      const names = getAllKnownAgentNames()
      expect(names).toHaveLength(9)
      expect(names).toContain('watson')
      expect(names).toContain('librarian')
      expect(names).toContain('dispatch')
      expect(names).toContain('dodo')
      expect(names).toContain('condor')
      expect(names).toContain('compass')
      expect(names).toContain('builder')
      expect(names).toContain('knowing-gnome')
      expect(names).toContain('producer')
    })
  })
})
