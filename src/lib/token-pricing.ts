import { getProviderFromModel } from '@/lib/provider-subscriptions'

interface ModelPricing {
  inputPerMTok: number
  outputPerMTok: number
}

const DEFAULT_MODEL_PRICING: ModelPricing = {
  inputPerMTok: 3.0,
  outputPerMTok: 15.0,
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'anthropic/claude-3-5-haiku-latest': { inputPerMTok: 0.8, outputPerMTok: 4.0 },
  // Opus 4.5/4.6/4.7 = $5/$25 (only the older Opus 4.1/4 line is $15/$75);
  // Haiku 4.5 = $1/$5 (Haiku 3.5 retired stays $0.80/$4); Sonnet 4.x = $3/$15.
  // Verified 2026-05 against platform.claude.com/docs/en/about-claude/pricing.
  'anthropic/claude-haiku-4-5': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  'anthropic/claude-haiku-4-5-20251001': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  'anthropic/claude-opus-4-1-20250805': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
  'anthropic/claude-opus-4-20250514': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
  'anthropic/claude-opus-4-5': { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  'anthropic/claude-opus-4-5-20251101': { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  'anthropic/claude-opus-4-6': { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  'anthropic/claude-opus-4-7': { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  'anthropic/claude-sonnet-4-20250514': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'anthropic/claude-sonnet-4-5': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'anthropic/claude-sonnet-4-5-20250929': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'anthropic/claude-sonnet-4-6': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-3-5-haiku': { inputPerMTok: 0.8, outputPerMTok: 4.0 },
  'claude-haiku-4-5': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  'claude-opus-4-1-20250805': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
  'claude-opus-4-20250514': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
  'claude-opus-4-5': { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  'claude-opus-4-5-20251101': { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  'claude-opus-4-6': { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  'claude-opus-4-7': { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  'claude-sonnet-4': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-sonnet-4-20250514': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-sonnet-4-5': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-sonnet-4-5-20250929': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-sonnet-4-6': { inputPerMTok: 3.0, outputPerMTok: 15.0 },

  // Non-Anthropic providers — verified 2026-07-04:
  // Groq https://groq.com/pricing; Moonshot Kimi K2.5 $0.60/$3.00
  // (https://openrouter.ai/moonshotai/kimi-k2.5, Moonshot list price);
  // MiniMax M2.1 $0.30/$1.20 (https://platform.minimax.io/docs/guides/pricing-paygo);
  // Venice https://docs.venice.ai/overview/pricing.
  'groq/llama-3.1-8b-instant': { inputPerMTok: 0.05, outputPerMTok: 0.08 },
  'groq/llama-3.3-70b-versatile': { inputPerMTok: 0.59, outputPerMTok: 0.79 },
  'minimax/minimax-m2.1': { inputPerMTok: 0.3, outputPerMTok: 1.2 },
  'moonshot/kimi-k2.5': { inputPerMTok: 0.6, outputPerMTok: 3.0 },
  'ollama/deepseek-r1:14b': { inputPerMTok: 0.0, outputPerMTok: 0.0 },
  'ollama/qwen2.5-coder:14b': { inputPerMTok: 0.0, outputPerMTok: 0.0 },
  'ollama/qwen2.5-coder:7b': { inputPerMTok: 0.0, outputPerMTok: 0.0 },
  'venice/llama-3.3-70b': { inputPerMTok: 0.7, outputPerMTok: 2.8 },
}

function normalizedModelName(modelName: string): string {
  return modelName.trim().toLowerCase()
}

export function getModelPricing(modelName: string): ModelPricing {
  const normalized = normalizedModelName(modelName)
  if (MODEL_PRICING[normalized] !== undefined) return MODEL_PRICING[normalized]

  for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
    const shortName = model.split('/').pop() || model
    if (normalized.includes(shortName)) return pricing
  }

  return DEFAULT_MODEL_PRICING
}

interface CostOptions {
  providerSubscriptions?: Record<string, boolean>
}

export function calculateTokenCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  options?: CostOptions,
): number {
  const provider = getProviderFromModel(modelName)
  if (provider !== 'unknown' && options?.providerSubscriptions?.[provider]) {
    return 0
  }

  const pricing = getModelPricing(modelName)
  return ((inputTokens * pricing.inputPerMTok) + (outputTokens * pricing.outputPerMTok)) / 1_000_000
}
