/**
 * Model cost lookup table and estimation helpers.
 *
 * Prices are per 1M tokens (input / output / cacheRead / cacheWrite).
 * Source: official pricing pages as of Feb 2026.
 *
 * Ported from Command Post dashboard/lib/usage/costs.ts
 */

export type ModelPricing = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
};

/** Per-1M-token pricing */
export const MODEL_COSTS: Record<string, ModelPricing> = {
  // ── Anthropic ──
  'claude-opus-4-5': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-3-5': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  'claude-3-5-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  'claude-3-opus': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },

  // ── OpenAI ──
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075 },
  'gpt-4-turbo': { input: 10, output: 30 },
  o3: { input: 10, output: 40, cacheRead: 2.5 },
  'o3-mini': { input: 1.1, output: 4.4, cacheRead: 0.55 },
  o1: { input: 15, output: 60, cacheRead: 7.5 },
  'o1-mini': { input: 1.1, output: 4.4 },
  'o1-preview': { input: 15, output: 60 },
  codex: { input: 10, output: 40, cacheRead: 2.5 }, // Codex CLI uses o3-class

  // ── Google ──
  'gemini-2.5-pro': { input: 1.25, output: 10, cacheRead: 0.315 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6, cacheRead: 0.0375 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4, cacheRead: 0.025 },
  'gemini-1.5-pro': { input: 1.25, output: 5, cacheRead: 0.315 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3, cacheRead: 0.01875 },

  // ── Local / Free ──
  // Ollama models are free (self-hosted), but we track volume
  ollama: { input: 0, output: 0 },
};

/**
 * Find pricing for a model string. Does fuzzy matching:
 * "claude-sonnet-4-5-20260220" → "claude-sonnet-4-5"
 */
export function findModelPricing(model: string): ModelPricing | undefined {
  if (MODEL_COSTS[model]) return MODEL_COSTS[model];

  const norm = model.toLowerCase().replace(/-\d{8}$/, '');
  if (MODEL_COSTS[norm]) return MODEL_COSTS[norm];

  // Longest prefix match
  let bestKey = '';
  for (const key of Object.keys(MODEL_COSTS)) {
    if (norm.startsWith(key) && key.length > bestKey.length) {
      bestKey = key;
    }
  }
  if (bestKey) return MODEL_COSTS[bestKey];

  // Partial match: check if model contains any key
  for (const key of Object.keys(MODEL_COSTS)) {
    if (norm.includes(key)) return MODEL_COSTS[key];
  }

  return undefined;
}

/**
 * Estimate cost for a given token breakdown. Returns cost in USD.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens?: number,
  cacheWriteTokens?: number,
): number {
  const pricing = findModelPricing(model);
  if (!pricing) return 0;

  let cost = 0;
  const fullInput = cacheReadTokens ? inputTokens - cacheReadTokens : inputTokens;
  cost += Math.max(0, fullInput) * (pricing.input / 1_000_000);
  cost += outputTokens * (pricing.output / 1_000_000);

  if (cacheReadTokens && pricing.cacheRead) {
    cost += cacheReadTokens * (pricing.cacheRead / 1_000_000);
  }
  if (cacheWriteTokens && pricing.cacheWrite) {
    cost += cacheWriteTokens * (pricing.cacheWrite / 1_000_000);
  }

  return cost;
}

/**
 * Average cost per 1k tokens for a model (mean of input+output).
 */
export function costPer1kTokens(model: string): number {
  const pricing = findModelPricing(model);
  if (!pricing) return 0;
  return ((pricing.input + pricing.output) / 2) / 1000;
}
