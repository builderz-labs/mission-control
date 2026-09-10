import { MODEL_CATALOG, type ModelConfig } from './models'

export const ENGINE_ORDER = ['claude', 'codex', 'kimi', 'grok'] as const
export type EngineId = (typeof ENGINE_ORDER)[number]

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'max'] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

export const ENGINE_META: Record<EngineId, {
  label: string
  provider: string
  logo: string
  defaultAlias: string
}> = {
  claude: { label: 'Claude', provider: 'anthropic', logo: '/brand/claude-logo.png', defaultAlias: 'opus' },
  codex: { label: 'Codex', provider: 'openai', logo: '/brand/codex-logo.png', defaultAlias: 'gpt-4.1' },
  kimi: { label: 'Kimi', provider: 'moonshot', logo: '/brand/kimi-logo.png', defaultAlias: 'kimi' },
  grok: { label: 'Grok', provider: 'xai', logo: '/brand/grok-logo.png', defaultAlias: 'grok' },
}

export type ProviderAccess = Record<string, boolean>

export function engineForProvider(provider: string): EngineId | null {
  if (provider === 'anthropic') return 'claude'
  if (provider === 'openai') return 'codex'
  if (provider === 'moonshot') return 'kimi'
  if (provider === 'xai') return 'grok'
  return null
}

export function providerHasAccess(provider: string, access: ProviderAccess): boolean {
  if (Object.keys(access).length === 0) return engineForProvider(provider) !== null
  return access[provider] === true
}

export function accessibleEngines(access: ProviderAccess): EngineId[] {
  return ENGINE_ORDER.filter((engine) => providerHasAccess(ENGINE_META[engine].provider, access))
}

export function accessibleModels(access: ProviderAccess, catalog = MODEL_CATALOG): ModelConfig[] {
  return catalog.filter((model) => providerHasAccess(model.provider, access))
}

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value)
}

export function inferEngineFromText(value: string | undefined | null): EngineId | null {
  const hay = (value || '').toLowerCase()
  if (!hay) return null
  if (hay.includes('kimi') || hay.includes('moonshot')) return 'kimi'
  if (hay.includes('grok') || hay.includes('xai')) return 'grok'
  if (hay.includes('codex')) return 'codex'
  if (hay.includes('claude') || hay.includes('anthropic') || hay.includes('haiku') || hay.includes('sonnet') || hay.includes('opus')) return 'claude'
  if (hay.includes('gpt-') || hay.includes('openai')) return 'codex'
  return null
}

export function engineFromKind(kind: string | undefined): EngineId | null {
  if (kind === 'claude-code') return 'claude'
  if (kind === 'codex-cli') return 'codex'
  if (kind === 'kimi' || kind === 'grok') return kind
  return inferEngineFromText(kind)
}
