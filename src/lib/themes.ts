export interface ThemeMeta {
  id: string
  label: string
  group: 'light' | 'dark'
  swatch: string
  background?: string
}

export const THEMES: ThemeMeta[] = [
  { id: 'void', label: 'Void', group: 'dark', swatch: '#22D3EE', background: 'void-bg' },
  { id: 'midnight-blue', label: 'Midnight Blue', group: 'dark', swatch: '#3B82F6' },
  { id: 'synthwave', label: 'Synthwave', group: 'dark', swatch: '#F472B6', background: 'synthwave-bg' },
  { id: 'solarized-dark', label: 'Solarized Dark', group: 'dark', swatch: '#B58900' },
  { id: 'catppuccin', label: 'Catppuccin Mocha', group: 'dark', swatch: '#CBA6F7' },
  { id: 'dracula', label: 'Dracula', group: 'dark', swatch: '#50FA7B' },
  { id: 'nord', label: 'Nord', group: 'dark', swatch: '#88C0D0' },
  { id: 'vercel', label: 'Vercel', group: 'dark', swatch: '#EDEDED' },
  { id: 'lumina', label: 'Lumina', group: 'dark', swatch: '#C4963A' },
  { id: 'retro-terminal', label: 'Retro Terminal', group: 'dark', swatch: '#00FF41', background: 'terminal-bg' },
  { id: 'light', label: 'Light', group: 'light', swatch: '#6B7280' },
  { id: 'paper', label: 'Paper', group: 'light', swatch: '#8B6914' },
]

/** All theme IDs for the next-themes `themes` prop. */
export const THEME_IDS = THEMES.map(t => t.id)

/** Look up whether a theme is dark or light. */
export function isThemeDark(themeId: string): boolean {
  const meta = THEMES.find(t => t.id === themeId)
  return meta ? meta.group === 'dark' : true
}
