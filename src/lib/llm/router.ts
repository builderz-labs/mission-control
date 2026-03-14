/**
 * Tiered LLM router — selects the right adapter and model for each task.
 *
 * Three tiers:
 *   fast     → cheap/quick (haiku, llama3.2, groq-fast)
 *   standard → balanced (sonnet, gpt-4o-mini)
 *   complex  → maximum quality (opus, gpt-4o)
 *
 * The router reads config once, constructs adapters lazily, and provides
 * a single `complete()` function that callers use without knowing which
 * provider is behind it.
 */

import { config } from '@/lib/config'
import { logger } from '@/lib/logger'
import { getDatabase } from '@/lib/db'
import { calculateTokenCost } from '@/lib/token-pricing'
import { eventBus } from '@/lib/event-bus'
import type {
  InferenceAdapter,
  CompletionRequest,
  CompletionResponse,
  TaskTier,
  ChatMessage,
} from './inference-adapter'
import { getTierForTask } from './inference-adapter'
import { AnthropicAdapter } from './adapters/anthropic'
import { OpenAICompatibleAdapter } from './adapters/openai-compatible'

// --- Adapter registry (lazy singleton) ---

let _adapter: InferenceAdapter | null = null

function getAdapter(): InferenceAdapter {
  if (_adapter) return _adapter

  const { provider, apiKey, baseUrl } = config.llm

  switch (provider) {
    case 'anthropic':
      _adapter = new AnthropicAdapter(apiKey)
      break
    case 'openai':
      _adapter = new OpenAICompatibleAdapter('openai', apiKey, baseUrl || undefined)
      break
    case 'ollama':
      _adapter = new OpenAICompatibleAdapter('ollama', '', baseUrl || 'http://localhost:11434/v1')
      break
    default:
      // Treat unknown providers as OpenAI-compatible
      _adapter = new OpenAICompatibleAdapter(provider, apiKey, baseUrl || undefined)
  }

  return _adapter
}

/** Reset adapter (for testing) */
export function resetAdapter(): void {
  _adapter = null
}

/** Override adapter (for testing) */
export function setAdapter(adapter: InferenceAdapter): void {
  _adapter = adapter
}

// --- Model selection ---

function getModelForTier(tier: TaskTier): string {
  return config.llm.models[tier]
}

// --- Budget enforcement ---

interface BudgetResult {
  allowed: boolean
  spent: number
  limit: number
}

export function checkAgentBudget(agentId: number, workspaceId: number): BudgetResult {
  const limit = config.llm.budgetPerAgentDay
  if (limit <= 0) return { allowed: true, spent: 0, limit: 0 }

  const db = getDatabase()
  const dayStart = Math.floor(Date.now() / 1000) - (Math.floor(Date.now() / 1000) % 86400)

  const row = db.prepare(
    `SELECT COALESCE(SUM(
       CASE
         WHEN input_tokens > 0 OR output_tokens > 0
         THEN input_tokens * 0.003 / 1000 + output_tokens * 0.015 / 1000
         ELSE 0
       END
     ), 0) as total_cost
     FROM token_usage
     WHERE session_id = ? AND workspace_id = ? AND created_at >= ?`
  ).get(`agent-${agentId}`, workspaceId, dayStart) as { total_cost: number } | undefined

  const spent = row?.total_cost ?? 0
  return { allowed: spent < limit, spent, limit }
}

// --- Per-agent rate limiting (in-memory) ---

const agentCallTimestamps = new Map<number, number[]>()

function checkAgentRate(agentId: number): boolean {
  const maxPerMinute = config.llm.ratePerAgentPerMinute
  if (maxPerMinute <= 0) return true

  const now = Date.now()
  const windowStart = now - 60_000
  const timestamps = agentCallTimestamps.get(agentId) ?? []

  // Evict old entries
  const recent = timestamps.filter((t) => t > windowStart)
  if (recent.length >= maxPerMinute) {
    agentCallTimestamps.set(agentId, recent)
    return false
  }

  recent.push(now)
  agentCallTimestamps.set(agentId, recent)
  return true
}

// --- Token usage recording ---

function recordTokenUsage(
  model: string,
  agentId: number,
  workspaceId: number,
  inputTokens: number,
  outputTokens: number,
  taskId?: number,
): void {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const sessionId = `agent-${agentId}`

    // Validate taskId if provided
    let validatedTaskId: number | null = null
    if (taskId && taskId > 0) {
      const taskRow = db.prepare(
        'SELECT id FROM tasks WHERE id = ? AND workspace_id = ?'
      ).get(taskId, workspaceId) as { id: number } | undefined
      if (taskRow) validatedTaskId = taskRow.id
    }

    db.prepare(
      `INSERT INTO token_usage (model, session_id, input_tokens, output_tokens, created_at, workspace_id, task_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(model, sessionId, inputTokens, outputTokens, now, workspaceId, validatedTaskId)
  } catch (err) {
    logger.error({ err, agentId, model }, 'Failed to record token usage')
  }
}

// --- Public API ---

export interface LLMCallOptions {
  /** Agent making the call */
  agentId: number
  /** Workspace for multi-tenant scoping */
  workspaceId: number
  /** Task type for tier routing (e.g. 'conversation', 'importance-rating') */
  taskType?: string
  /** Explicit tier override */
  tier?: TaskTier
  /** Explicit model override (skips tier routing) */
  model?: string
  /** Associated task ID for cost attribution */
  taskId?: number
  /** Abort signal */
  signal?: AbortSignal
}

/**
 * High-level LLM completion — handles routing, budget, rate limiting, and recording.
 */
export async function complete(
  messages: ChatMessage[],
  options: LLMCallOptions,
): Promise<CompletionResponse> {
  if (!config.llm.enabled) {
    throw new Error('LLM features are disabled. Set LLM_ENABLED=true to enable.')
  }

  // Budget check
  const budget = checkAgentBudget(options.agentId, options.workspaceId)
  if (!budget.allowed) {
    throw new Error(
      `Agent ${options.agentId} exceeded daily budget ($${budget.spent.toFixed(4)} / $${budget.limit})`
    )
  }

  // Rate limit check
  if (!checkAgentRate(options.agentId)) {
    throw new Error(
      `Agent ${options.agentId} exceeded rate limit (${config.llm.ratePerAgentPerMinute}/min)`
    )
  }

  // Select model
  const tier = options.tier ?? getTierForTask(options.taskType ?? 'conversation')
  const model = options.model ?? getModelForTier(tier)

  const adapter = getAdapter()

  const request: CompletionRequest = {
    model,
    messages,
    maxTokens: config.llm.maxTokens,
    signal: options.signal,
  }

  logger.debug({ agentId: options.agentId, model, tier, taskType: options.taskType }, 'LLM call')

  const response = await adapter.complete(request)

  // Record usage
  recordTokenUsage(
    response.model,
    options.agentId,
    options.workspaceId,
    response.tokenCount.input,
    response.tokenCount.output,
    options.taskId,
  )

  // Broadcast for real-time dashboard updates
  eventBus.broadcast('activity.created' as any, {
    type: 'llm.completion',
    agentId: options.agentId,
    model: response.model,
    tier,
    tokens: response.tokenCount,
    cost: response.cost,
    latencyMs: response.latencyMs,
  })

  return response
}

export { getTierForTask, type TaskTier, type ChatMessage }
