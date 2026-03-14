/**
 * Anthropic Claude adapter — primary LLM provider.
 *
 * Uses raw fetch (zero dependencies) to the Anthropic Messages API.
 * Supports claude-haiku-4-5, claude-sonnet-4-5, claude-opus-4-6.
 */

import { calculateTokenCost } from '@/lib/token-pricing'
import type {
  InferenceAdapter,
  CompletionRequest,
  CompletionResponse,
} from '../inference-adapter'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/** Map short aliases to full model IDs */
const MODEL_ALIASES: Record<string, string> = {
  'claude-haiku-4-5': 'claude-haiku-4-5-20250514',
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250514',
  'claude-opus-4-6': 'claude-opus-4-6-20250618',
}

function resolveModel(model: string): string {
  return MODEL_ALIASES[model] ?? model
}

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AnthropicResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: Array<{ type: 'text'; text: string }>
  model: string
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | null
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

interface AnthropicErrorResponse {
  type: 'error'
  error: { type: string; message: string }
}

export class AnthropicAdapter implements InferenceAdapter {
  readonly provider = 'anthropic'
  private readonly apiKey: string

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('Anthropic API key is required')
    this.apiKey = apiKey
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startMs = Date.now()
    const resolvedModel = resolveModel(request.model)

    // Split system message from conversation messages
    let system: string | undefined
    const messages: AnthropicMessage[] = []

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        system = (system ? system + '\n\n' : '') + msg.content
      } else {
        messages.push({ role: msg.role, content: msg.content })
      }
    }

    // Anthropic requires at least one user message
    if (messages.length === 0) {
      messages.push({ role: 'user', content: 'Hello.' })
    }

    const body: Record<string, unknown> = {
      model: resolvedModel,
      messages,
      max_tokens: request.maxTokens ?? 4096,
    }
    if (system) body.system = system
    if (request.temperature !== undefined) body.temperature = request.temperature

    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: { message: res.statusText } })) as AnthropicErrorResponse
      throw new Error(
        `Anthropic API error (${res.status}): ${errBody.error?.message ?? res.statusText}`
      )
    }

    const data = await res.json() as AnthropicResponse
    const text = data.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('')

    const latencyMs = Date.now() - startMs
    const cost = calculateTokenCost(
      resolvedModel,
      data.usage.input_tokens,
      data.usage.output_tokens,
    )

    return {
      text,
      tokenCount: {
        input: data.usage.input_tokens,
        output: data.usage.output_tokens,
      },
      cost,
      latencyMs,
      model: data.model,
      stopReason: data.stop_reason ?? undefined,
    }
  }
}
