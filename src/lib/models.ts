export interface ModelConfig {
  alias: string
  name: string
  provider: string
  description: string
  costPer1k: number
}

export const MODEL_CATALOG: ModelConfig[] = [
  // Anthropic (your active models)
  { alias: 'opus', name: 'anthropic/claude-opus-4-6', provider: 'anthropic', description: 'Premium quality, deep reasoning', costPer1k: 15.0 },
  { alias: 'sonnet', name: 'anthropic/claude-sonnet-4-6', provider: 'anthropic', description: 'Standard workhorse (your default)', costPer1k: 3.0 },
  { alias: 'haiku', name: 'anthropic/claude-haiku-4-5', provider: 'anthropic', description: 'Fast + cheap, routine tasks', costPer1k: 0.25 },
  // OpenAI / Codex
  { alias: 'gpt', name: 'openai/gpt-5.2', provider: 'openai', description: 'GPT-5.2 via Codex', costPer1k: 10.0 },
  { alias: 'codex', name: 'openai-codex/gpt-5.3-codex', provider: 'openai-codex', description: 'Codex 5.3, strong coding', costPer1k: 10.0 },
  // Local Qwen (free, on your VPS)
  { alias: 'local9b', name: 'ollama/qwen3.5-9b-local', provider: 'ollama', description: 'Local Qwen 9B — quality (~6 tok/s, free)', costPer1k: 0.0 },
  { alias: 'local4b', name: 'ollama/qwen3.5-4b-local', provider: 'ollama', description: 'Local Qwen 4B — fast (~12 tok/s, free)', costPer1k: 0.0 },
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
