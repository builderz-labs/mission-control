/**
 * Provider-agnostic LLM interface.
 *
 * Inspired by Agent Office's InferenceAdapter pattern — a thin abstraction
 * over any LLM provider (Anthropic, OpenAI, Ollama, Groq, etc.).
 *
 * All adapters speak the same language so the router can swap providers
 * without touching business logic.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CompletionRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  responseFormat?: 'text' | 'json'
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

export interface CompletionResponse {
  text: string
  tokenCount: { input: number; output: number }
  cost: number
  latencyMs: number
  model: string
  /** Stop reason from the provider */
  stopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | string
}

export interface InferenceAdapter {
  readonly provider: string

  /** Send a completion request and return the full response. */
  complete(request: CompletionRequest): Promise<CompletionResponse>

  /** Generate a text embedding. Optional — not all providers support it. */
  embed?(text: string): Promise<number[]>
}

/** Task complexity tier for model routing. */
export type TaskTier = 'fast' | 'standard' | 'complex'

/** Maps task types to tiers. Callers use descriptive labels, router picks the model. */
export const TASK_TIER_MAP: Record<string, TaskTier> = {
  // Fast: cheap, simple outputs
  'status-update': 'fast',
  'importance-rating': 'fast',
  'movement-decision': 'fast',
  'simple-reply': 'fast',
  'classification': 'fast',

  // Standard: normal conversation and analysis
  'conversation': 'standard',
  'memory-reflection': 'standard',
  'summarization': 'standard',
  'persona-update': 'standard',
  'code-review': 'standard',

  // Complex: deep reasoning
  'architecture': 'complex',
  'debugging': 'complex',
  'planning': 'complex',
  'sop-execution': 'complex',
  'persona-simulation': 'complex',
}

export function getTierForTask(taskType: string): TaskTier {
  return TASK_TIER_MAP[taskType] ?? 'standard'
}
