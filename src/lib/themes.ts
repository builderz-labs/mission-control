export interface ThemeMeta {
  id: string
  label: string
  group: 'dark' | 'light'
  swatch: string
}

export const THEMES: ThemeMeta[] = [
  { id: 'dark', label: 'Mission Control', group: 'dark', swatch: '#0f1117' },
  { id: 'light', label: 'Light', group: 'light', swatch: '#fafafa' },
]

export const THEME_IDS = THEMES.map(t => t.id)

export function isThemeDark(themeId: string): boolean {
  const theme = THEMES.find(t => t.id === themeId)
  return theme ? theme.group === 'dark' : true
}
