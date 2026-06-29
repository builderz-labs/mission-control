/**
 * MODEL_CATALOG - Canonical model definitions for Mission Control.
 *
 * ⚠️  BLINDAJE ACTIVO: Esta lista es la fuente de verdad del dashboard.
 *     NO modificar sin actualizar también:
 *       - ~/.openclaw/models-canonical.json
 *       - ~/.openclaw/openclaw.json (sección models.providers.blockrun)
 *     Ejecutar: ~/.openclaw/scripts/validate-models.sh después de cualquier cambio.
 *
 * Última sincronización: 2026-03-23
 */

export interface ModelConfig {
  alias: string
  name: string
  provider: string
  description: string
  costPer1k: number
  reasoning?: boolean
  vision?: boolean
}

export const MODEL_CATALOG: ModelConfig[] = [
  // ── Anthropic ──────────────────────────────────────────
  { alias: 'haiku', name: 'anthropic/claude-haiku-4.5', provider: 'anthropic', description: 'Ultra-cheap, simple tasks', costPer1k: 1.0, reasoning: false, vision: true },
  { alias: 'sonnet', name: 'anthropic/claude-sonnet-4.6', provider: 'anthropic', description: 'Standard workhorse', costPer1k: 3.0, reasoning: true, vision: true },
  { alias: 'opus', name: 'anthropic/claude-opus-4.6', provider: 'anthropic', description: 'Premium quality', costPer1k: 5.0, reasoning: true, vision: true },

  // ── OpenAI ─────────────────────────────────────────────
  { alias: 'gpt5', name: 'openai/gpt-5.4', provider: 'openai', description: 'GPT-5.4 reasoning + vision', costPer1k: 2.5, reasoning: true, vision: true },
  { alias: 'gpt5-pro', name: 'openai/gpt-5.4-pro', provider: 'openai', description: 'GPT-5.4 Pro (premium reasoning)', costPer1k: 30.0, reasoning: true },
  { alias: 'gpt5-mini', name: 'openai/gpt-5-mini', provider: 'openai', description: 'GPT-5 Mini (cost-effective)', costPer1k: 0.25 },
  { alias: 'codex', name: 'openai/gpt-5.2-codex', provider: 'openai', description: 'Codex coding specialist', costPer1k: 1.75 },
  { alias: 'o3', name: 'openai/o3', provider: 'openai', description: 'o3 reasoning', costPer1k: 2.0, reasoning: true },

  // ── Google ─────────────────────────────────────────────
  { alias: 'gemini', name: 'google/gemini-3.1-pro', provider: 'google', description: 'Gemini 3.1 Pro (1M context)', costPer1k: 2.0, reasoning: true, vision: true },
  { alias: 'flash', name: 'google/gemini-2.5-flash', provider: 'google', description: 'Gemini Flash (fast + cheap)', costPer1k: 0.3, vision: true },

  // ── DeepSeek ───────────────────────────────────────────
  { alias: 'deepseek', name: 'deepseek/deepseek-chat', provider: 'deepseek', description: 'DeepSeek V3.2 Chat', costPer1k: 0.28 },
  { alias: 'reasoner', name: 'deepseek/deepseek-reasoner', provider: 'deepseek', description: 'DeepSeek V3.2 Reasoner', costPer1k: 0.28, reasoning: true },

  // ── Moonshot ───────────────────────────────────────────
  { alias: 'kimi', name: 'moonshot/kimi-k2.5', provider: 'moonshot', description: 'Kimi K2.5 (vision + reasoning)', costPer1k: 0.6, reasoning: true, vision: true },

  // ── xAI ────────────────────────────────────────────────
  { alias: 'grok', name: 'xai/grok-3', provider: 'xai', description: 'Grok 3 reasoning', costPer1k: 3.0, reasoning: true },
  { alias: 'grok-fast', name: 'xai/grok-4-fast-reasoning', provider: 'xai', description: 'Grok 4 Fast (ultra cheap)', costPer1k: 0.2, reasoning: true },
  { alias: 'grok-code', name: 'xai/grok-code-fast-1', provider: 'xai', description: 'Grok Code Fast', costPer1k: 0.2 },

  // ── MiniMax ────────────────────────────────────────────
  { alias: 'minimax', name: 'minimax/minimax-m2.5', provider: 'minimax', description: 'MiniMax M2.5 (cost-effective reasoning)', costPer1k: 0.3, reasoning: true },

  // ── NVIDIA (Free) ──────────────────────────────────────
  { alias: 'nvidia', name: 'nvidia/gpt-oss-120b', provider: 'nvidia', description: 'NVIDIA GPT-OSS 120B (free)', costPer1k: 0.0 },

  // ── Smart Router ───────────────────────────────────────
  { alias: 'auto', name: 'auto', provider: 'blockrun', description: 'Smart Router (balanced)', costPer1k: 0.0 },
  { alias: 'eco', name: 'eco', provider: 'blockrun', description: 'Smart Router (cost optimized)', costPer1k: 0.0 },
  { alias: 'premium', name: 'premium', provider: 'blockrun', description: 'Smart Router (best quality)', costPer1k: 0.0 },
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

export function getModelsByProvider(provider: string): ModelConfig[] {
  return MODEL_CATALOG.filter(m => m.provider === provider)
}
