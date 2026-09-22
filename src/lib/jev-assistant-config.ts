export type JevAssistantProviderKind = 'claude-cli' | 'anthropic' | 'openai'
export interface JevAssistantOption {
  kind: JevAssistantProviderKind
  label: string
  model: string
  configured: boolean
}

export function resolveJevAssistantProvider(requested?: JevAssistantProviderKind): JevAssistantProviderKind {
  if (requested) return requested
  const configured = process.env.JEV_ASSISTANT_PROVIDER?.trim()
  if (configured === 'openai' || configured === 'anthropic' || configured === 'claude-cli') return configured
  return 'claude-cli'
}

export function jevAssistantModel(kind: JevAssistantProviderKind): string {
  const configured = kind === 'openai' ? process.env.JEV_OPENAI_MODEL
    : kind === 'anthropic' ? process.env.JEV_ANTHROPIC_MODEL : process.env.JEV_ASSISTANT_MODEL
  const fallback = kind === 'openai' ? 'gpt-4.1-mini' : kind === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'haiku'
  const model = configured?.trim() || fallback
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(model) ? model : fallback
}

export function jevAssistantOptions(cliAvailable: boolean): JevAssistantOption[] {
  return [
    { kind: 'anthropic', label: 'Claude API', model: jevAssistantModel('anthropic'), configured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()) },
    { kind: 'openai', label: 'OpenAI API', model: jevAssistantModel('openai'), configured: Boolean(process.env.OPENAI_API_KEY?.trim()) },
    { kind: 'claude-cli', label: 'Claude Code', model: jevAssistantModel('claude-cli'), configured: cliAvailable },
  ]
}
