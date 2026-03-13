import { describe, expect, it } from 'vitest'

/**
 * Tests for the null-safe trim patterns used in agent model config editing.
 * These mirror the logic in agent-detail-tabs.tsx (updateModelConfig + handleSave).
 */

function dedupFallbacks(fallbacks: (string | undefined | null)[]): string[] {
  return [...new Set((fallbacks || []).map((value) => (value || '').trim()).filter(Boolean))]
}

function safePrimary(primary: string | undefined | null): string {
  return (primary || '').trim()
}

function filterFallbacks(fallbacks: (string | undefined | null)[]): string[] {
  return fallbacks.filter(f => f && f.trim()) as string[]
}

describe('agent model config trim safety', () => {
  describe('dedupFallbacks (updateModelConfig pattern)', () => {
    it('handles normal string values', () => {
      expect(dedupFallbacks(['gpt-4', 'claude-3'])).toEqual(['gpt-4', 'claude-3'])
    })

    it('handles undefined values without throwing', () => {
      expect(dedupFallbacks([undefined, 'gpt-4', undefined])).toEqual(['gpt-4'])
    })

    it('handles null values without throwing', () => {
      expect(dedupFallbacks([null, 'gpt-4'])).toEqual(['gpt-4'])
    })

    it('filters out empty strings', () => {
      expect(dedupFallbacks(['', '  ', 'gpt-4'])).toEqual(['gpt-4'])
    })

    it('deduplicates models', () => {
      expect(dedupFallbacks(['gpt-4', 'gpt-4', 'claude-3'])).toEqual(['gpt-4', 'claude-3'])
    })

    it('handles empty array', () => {
      expect(dedupFallbacks([])).toEqual([])
    })
  })

  describe('safePrimary (handleSave pattern)', () => {
    it('trims normal string', () => {
      expect(safePrimary('  gpt-4  ')).toBe('gpt-4')
    })

    it('handles undefined without throwing', () => {
      expect(safePrimary(undefined)).toBe('')
    })

    it('handles null without throwing', () => {
      expect(safePrimary(null)).toBe('')
    })

    it('handles empty string', () => {
      expect(safePrimary('')).toBe('')
    })
  })

  describe('filterFallbacks (handleSave pattern)', () => {
    it('filters valid values', () => {
      expect(filterFallbacks(['gpt-4', 'claude-3'])).toEqual(['gpt-4', 'claude-3'])
    })

    it('filters out undefined without throwing', () => {
      expect(filterFallbacks([undefined, 'gpt-4'])).toEqual(['gpt-4'])
    })

    it('filters out null without throwing', () => {
      expect(filterFallbacks([null, 'gpt-4'])).toEqual(['gpt-4'])
    })

    it('filters out empty strings', () => {
      expect(filterFallbacks(['', 'gpt-4'])).toEqual(['gpt-4'])
    })

    it('filters out whitespace-only strings', () => {
      expect(filterFallbacks(['   ', 'gpt-4'])).toEqual(['gpt-4'])
    })
  })
})
