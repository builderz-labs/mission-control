export interface ModelConfig {
  alias: string
  name: string
  provider: string
  description: string
  costPer1k: number
}

export const MODEL_CATALOG: ModelConfig[] = [
  { alias: 'haiku', name: 'anthropic/claude-3-5-haiku-latest', provider: 'anthropic', description: 'Ultra-cheap, simple tasks', costPer1k: 0.25 },
  { alias: 'sonnet', name: 'anthropic/claude-sonnet-4-20250514', provider: 'anthropic', description: 'Standard workhorse', costPer1k: 3.0 },
  { alias: 'opus', name: 'anthropic/claude-opus-4-5', provider: 'anthropic', description: 'Premium quality', costPer1k: 15.0 },
  { alias: 'deepseek', name: 'ollama/deepseek-r1:14b', provider: 'ollama', description: 'Local reasoning (free)', costPer1k: 0.0 },
  { alias: 'groq-fast', name: 'groq/llama-3.1-8b-instant', provider: 'groq', description: '840 tok/s, ultra fast', costPer1k: 0.05 },
  { alias: 'groq', name: 'groq/llama-3.3-70b-versatile', provider: 'groq', description: 'Fast + quality balance', costPer1k: 0.59 },
  { alias: 'kimi', name: 'moonshot/kimi-k2.5', provider: 'moonshot', description: 'Alternative provider', costPer1k: 1.0 },
  { alias: 'minimax', name: 'minimax/minimax-m2.1', provider: 'minimax', description: 'Cost-effective (1/10th price), strong coding', costPer1k: 0.3 },
  { alias: 'grok-2', name: 'xai/grok-2-latest', provider: 'xai', description: 'Standard XAI model', costPer1k: 2.0 },
  { alias: 'grok-beta', name: 'xai/grok-beta', provider: 'xai', description: 'Beta XAI features', costPer1k: 5.0 },
  { alias: 'gpt-4o', name: 'openai/gpt-4o', provider: 'openai', description: 'High capability model', costPer1k: 2.5 },
  { alias: 'gpt-4o-mini', name: 'openai/gpt-4o-mini', provider: 'openai', description: 'Fast, cheap everyday model', costPer1k: 0.15 },
  { alias: 'gemini-pro', name: 'google/gemini-2.5-pro', provider: 'google', description: 'Complex reasoning', costPer1k: 1.25 },
  { alias: 'gemini-flash', name: 'google/gemini-2.5-flash', provider: 'google', description: 'Fast reasoning', costPer1k: 0.075 },
]

export function getModelByAlias(alias: string): ModelConfig | undefined {
  return MODEL_CATALOG.find(m => m.alias === alias)
}

export function getModelByName(name: string): ModelConfig | undefined {
  return MODEL_CATALOG.find(m => m.name === name)
}

export function getAllModels(): ModelConfig[] {
  return [...MODEL_CATALOG]
}
