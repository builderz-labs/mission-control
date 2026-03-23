import { describe, it, expect } from 'vitest'
import { THEMES, THEME_IDS, isThemeDark } from '../themes'

describe('THEMES', () => {
  it('has exactly one light theme', () => {
    expect(THEMES).toHaveLength(1)
    expect(THEMES[0]?.id).toBe('light')
    expect(THEMES[0]?.group).toBe('light')
  })

  it('each theme has required fields', () => {
    for (const theme of THEMES) {
      expect(theme.id).toBeTruthy()
      expect(theme.label).toBeTruthy()
      expect(theme.group).toBe('light')
      expect(theme.swatch).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('has unique IDs', () => {
    const ids = THEMES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('THEME_IDS', () => {
  it('matches THEMES array', () => {
    expect(THEME_IDS).toHaveLength(THEMES.length)
    for (const theme of THEMES) {
      expect(THEME_IDS).toContain(theme.id)
    }
  })

  it('contains only light', () => {
    expect(THEME_IDS).toEqual(['light'])
  })
})

describe('isThemeDark', () => {
  it('always returns false for known and unknown IDs', () => {
    expect(isThemeDark('light')).toBe(false)
    expect(isThemeDark('unknown-theme')).toBe(false)
    expect(isThemeDark('')).toBe(false)
  })
})
