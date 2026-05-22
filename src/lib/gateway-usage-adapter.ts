/**
 * Phase 6 BUILD — gateway-native usage shape adapter.
 *
 * The OpenClaw gateway emits `token_usage` events in two shapes:
 *
 *   1. MC-native (post-adapter)
 *      { type: 'token_usage', model, sessionId, inputTokens,
 *        outputTokens, totalTokens, cost }
 *
 *   2. Gateway-native (Anthropic SDK usage block, snake_case)
 *      { type: 'token_usage' | 'usage' | 'anthropic_usage',
 *        model,
 *        session_id?,
 *        request_id?,
 *        usage: { input_tokens, output_tokens,
 *                 cache_creation_input_tokens?, cache_read_input_tokens? },
 *        agent?, task_id?, tenant_slug? }
 *
 * This module accepts either, normalizes to MC-native, derives cost
 * locally via `calculateTokenCost` from `./token-pricing` (MC owns
 * pricing). Failed/unknown-model requests still emit (cost=0) so the
 * audit row + capacity-planning queries see the call attempt.
 *
 * Phase 6 design: docs/artifacts/phase-6-adapter-design.md
 * D18 edge-case checklist: docs/artifacts/phase-6-edge-case-checklist.md
 */

import { getModelPricing } from './model-pricing-table'

// Client-safe cost derivation. Imports from `./model-pricing-table`
// (pure data, no Node imports) instead of `./token-pricing` (transitively
// pulls `provider-subscriptions` which uses node:fs / node:child_process
// and breaks client bundling under Next.js 16 Turbopack).
//
// Subscription-based zero-cost handling (Claude Pro / Max plans) lives
// server-side at persistence time; client-side cost is the raw
// pricing-table product.
function deriveClientSafeCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getModelPricing(model)
  return ((inputTokens * pricing.inputPerMTok) + (outputTokens * pricing.outputPerMTok)) / 1_000_000
}

export interface McTokenUsageEvent {
  type: 'token_usage'
  model: string
  sessionId: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  agentName?: string
  taskId?: string
  cacheCreationTokens?: number
  cacheReadTokens?: number
}

interface GatewayUsageRaw {
  type?: string
  model?: unknown
  session_id?: unknown
  sessionId?: unknown
  request_id?: unknown
  inputTokens?: unknown
  outputTokens?: unknown
  totalTokens?: unknown
  cost?: unknown
  usage?: {
    input_tokens?: unknown
    output_tokens?: unknown
    cache_creation_input_tokens?: unknown
    cache_read_input_tokens?: unknown
  }
  agent?: unknown
  agentName?: unknown
  task_id?: unknown
  taskId?: unknown
  tenant_slug?: unknown
}

function toInt(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v))
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n))
  }
  return 0
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function isMcNativeShape(raw: GatewayUsageRaw): boolean {
  // Native shape has explicit camelCase token fields at top level.
  return (
    typeof raw.inputTokens === 'number' ||
    typeof raw.outputTokens === 'number' ||
    typeof raw.totalTokens === 'number'
  )
}

function hasGatewayUsageBlock(raw: GatewayUsageRaw): boolean {
  if (!raw.usage || typeof raw.usage !== 'object') return false
  return (
    typeof raw.usage.input_tokens === 'number' ||
    typeof raw.usage.output_tokens === 'number'
  )
}

/**
 * Adapt either MC-native or gateway-native usage shape to MC-native.
 * Returns null when no recognizable shape (caller drops the frame).
 *
 * `fallbackSessionId` — supplied by the websocket layer when the frame
 * omits `session_id`/`sessionId`. The MC chat surface scopes cost rows
 * by session; we never emit a row without a session.
 */
export function adaptGatewayUsage(
  raw: GatewayUsageRaw,
  fallbackSessionId: string,
): McTokenUsageEvent | null {
  const model = toStr(raw.model)
  if (!model) return null

  const sessionId = toStr(raw.session_id) || toStr(raw.sessionId) || fallbackSessionId
  if (!sessionId) return null

  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let cacheCreationTokens = 0
  let cacheReadTokens = 0
  let cost: number | undefined

  if (isMcNativeShape(raw)) {
    // Native path: trust the upstream-computed cost when present.
    inputTokens = toInt(raw.inputTokens)
    outputTokens = toInt(raw.outputTokens)
    totalTokens = toInt(raw.totalTokens) || inputTokens + outputTokens
    if (typeof raw.cost === 'number' && Number.isFinite(raw.cost) && raw.cost >= 0) {
      cost = raw.cost
    }
  } else if (hasGatewayUsageBlock(raw)) {
    const u = raw.usage!
    inputTokens = toInt(u.input_tokens)
    outputTokens = toInt(u.output_tokens)
    cacheCreationTokens = toInt(u.cache_creation_input_tokens)
    cacheReadTokens = toInt(u.cache_read_input_tokens)
    // Sum policy: count cache tokens as additional input tokens for
    // accounting purposes. Cache reads are priced lower in some Anthropic
    // tiers — out of scope for V1, calculated at the input rate.
    inputTokens = inputTokens + cacheCreationTokens + cacheReadTokens
    totalTokens = inputTokens + outputTokens
  } else {
    return null
  }

  if (cost === undefined) {
    cost = deriveClientSafeCost(model, inputTokens, outputTokens)
  }

  const agentName = toStr(raw.agent) || toStr(raw.agentName) || undefined
  const taskId = toStr(raw.task_id) || toStr(raw.taskId) || undefined

  const result: McTokenUsageEvent = {
    type: 'token_usage',
    model,
    sessionId,
    inputTokens,
    outputTokens,
    totalTokens,
    cost,
  }
  if (agentName) result.agentName = agentName
  if (taskId) result.taskId = taskId
  if (cacheCreationTokens > 0) result.cacheCreationTokens = cacheCreationTokens
  if (cacheReadTokens > 0) result.cacheReadTokens = cacheReadTokens
  return result
}
