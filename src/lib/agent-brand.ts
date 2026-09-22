export type AgentBrand = 'claude' | 'codex' | 'grok' | 'kimi' | 'hermes' | 'unknown'

const BRAND_LOGOS: Record<Exclude<AgentBrand, 'unknown'>, { src: string; alt: string }> = {
  claude: { src: '/brand/claude-logo.png', alt: 'Claude' },
  codex: { src: '/brand/codex-logo.png', alt: 'Codex' },
  grok: { src: '/brand/grok-logo.svg', alt: 'Grok' },
  kimi: { src: '/brand/kimi-logo.svg', alt: 'Kimi' },
  hermes: { src: '/brand/hermes-logo.png', alt: 'Hermes' },
}

export function brandFromAgent(name?: string | null, runtimeType?: string | null): AgentBrand {
  const runtime = (runtimeType || '').toLowerCase()
  if (runtime.includes('claude')) return 'claude'
  if (runtime.includes('codex')) return 'codex'
  if (runtime.includes('grok')) return 'grok'
  if (runtime.includes('kimi')) return 'kimi'
  if (runtime.includes('hermes')) return 'hermes'
  const value = (name || '').toLowerCase()
  if (value.includes('claude')) return 'claude'
  if (value.includes('codex')) return 'codex'
  if (value.includes('grok')) return 'grok'
  if (value.includes('kimi')) return 'kimi'
  if (value.includes('hermes')) return 'hermes'
  return 'unknown'
}

export function brandLogo(brand: AgentBrand): { src: string; alt: string } | null {
  if (brand === 'unknown') return null
  return BRAND_LOGOS[brand]
}
