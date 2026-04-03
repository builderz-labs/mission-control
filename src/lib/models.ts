export interface ModelConfig {
  readonly alias: string
  readonly name: string
  readonly provider: string
  readonly description: string
  readonly costPer1kInput: number
  readonly costPer1kOutput: number
  readonly maxContextTokens: number
}

const MODEL_CATALOG: readonly ModelConfig[] = Object.freeze([
  { alias: 'haiku', name: 'anthropic/claude-3-5-haiku-latest', provider: 'anthropic', description: 'Ultra-cheap, simple tasks', costPer1kInput: 0.25, costPer1kOutput: 1.25, maxContextTokens: 200000 },
  { alias: 'sonnet', name: 'anthropic/claude-sonnet-4-20250514', provider: 'anthropic', description: 'Standard workhorse', costPer1kInput: 3.0, costPer1kOutput: 15.0, maxContextTokens: 200000 },
  { alias: 'opus', name: 'anthropic/claude-opus-4-20250514', provider: 'anthropic', description: 'Premium quality', costPer1kInput: 15.0, costPer1kOutput: 75.0, maxContextTokens: 200000 },
  { alias: 'deepseek', name: 'ollama/deepseek-r1:14b', provider: 'ollama', description: 'Local reasoning (free)', costPer1kInput: 0.0, costPer1kOutput: 0.0, maxContextTokens: 128000 },
  { alias: 'groq-fast', name: 'groq/llama-3.1-8b-instant', provider: 'groq', description: '840 tok/s, ultra fast', costPer1kInput: 0.05, costPer1kOutput: 0.08, maxContextTokens: 131072 },
  { alias: 'groq', name: 'groq/llama-3.3-70b-versatile', provider: 'groq', description: 'Fast + quality balance', costPer1kInput: 0.59, costPer1kOutput: 0.79, maxContextTokens: 131072 },
  { alias: 'kimi', name: 'moonshot/kimi-k2.5', provider: 'moonshot', description: 'Alternative provider', costPer1kInput: 1.0, costPer1kOutput: 2.0, maxContextTokens: 131072 },
  { alias: 'venice-llama-3.3-70b', name: 'venice/llama-3.3-70b', provider: 'venice', description: 'Venice AI Llama 3.3 70B', costPer1kInput: 0.7, costPer1kOutput: 0.7, maxContextTokens: 131072 },
  { alias: 'minimax', name: 'minimax/minimax-m2.1', provider: 'minimax', description: 'Cost-effective (1/10th price), strong coding', costPer1kInput: 0.3, costPer1kOutput: 0.6, maxContextTokens: 1000000 },
] as const)

export function getModelByAlias(alias: string): ModelConfig | undefined {
  return MODEL_CATALOG.find(m => m.alias === alias)
}

export function getModelByName(name: string): ModelConfig | undefined {
  return MODEL_CATALOG.find(m => m.name === name)
}

export function getAllModels(): readonly ModelConfig[] {
  return MODEL_CATALOG
}
