export interface ThemeMeta {
  id: string
  label: string
  group: 'light'
  swatch: string
  background?: string
}

export const THEMES: ThemeMeta[] = [
  { id: 'light', label: "Operator's Desk", group: 'light', swatch: '#9A5D3A' },
]

/** All theme IDs for the next-themes `themes` prop. */
export const THEME_IDS = THEMES.map(t => t.id)

/** Look up whether a theme is dark or light. Always light now. */
export function isThemeDark(_themeId: string): boolean {
  return false
}
