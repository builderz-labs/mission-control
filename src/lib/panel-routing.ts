const PANEL_ALIASES: Readonly<Record<string, string>> = {
  'agent-costs': 'cost-tracker',
  'gateway-parent': 'gateways',
  history: 'activity',
  sessions: 'chat',
  tokens: 'cost-tracker',
}

export function canonicalPanelId(panel: string): string {
  const normalized = panel.trim().replace(/^\/+|\/+$/g, '') || 'overview'
  return PANEL_ALIASES[normalized] || normalized
}

export function panelPath(panel: string): string {
  const canonical = canonicalPanelId(panel)
  return canonical === 'overview' ? '/' : `/${canonical}`
}

