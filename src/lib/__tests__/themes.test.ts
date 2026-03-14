import { describe, it, expect } from 'vitest'
import { THEMES, THEME_IDS, isThemeDark } from '../themes'

describe('THEMES', () => {
  it('has entries', () => {
    expect(THEMES.length).toBeGreaterThan(0)
  })

  it('each theme has required fields', () => {
    for (const theme of THEMES) {
      expect(theme.id).toBeTruthy()
      expect(theme.label).toBeTruthy()
      expect(['light', 'dark']).toContain(theme.group)
      expect(theme.swatch).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('has unique IDs', () => {
    const ids = THEMES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has both light and dark themes', () => {
    expect(THEMES.some(t => t.group === 'light')).toBe(true)
    expect(THEMES.some(t => t.group === 'dark')).toBe(true)
  })
})

describe('THEME_IDS', () => {
  it('matches THEMES array', () => {
    expect(THEME_IDS).toHaveLength(THEMES.length)
    for (const theme of THEMES) {
      expect(THEME_IDS).toContain(theme.id)
    }
  })
})

describe('isThemeDark', () => {
  it('returns true for dark themes', () => {
    const darkTheme = THEMES.find(t => t.group === 'dark')!
    expect(isThemeDark(darkTheme.id)).toBe(true)
  })

  it('returns false for light themes', () => {
    const lightTheme = THEMES.find(t => t.group === 'light')!
    expect(isThemeDark(lightTheme.id)).toBe(false)
  })

  it('returns true (default) for unknown theme ID', () => {
    expect(isThemeDark('unknown-theme')).toBe(true)
    expect(isThemeDark('')).toBe(true)
  })

  it('returns correct value for known themes', () => {
    expect(isThemeDark('light')).toBe(false)
    expect(isThemeDark('void')).toBe(true)
  })
})
