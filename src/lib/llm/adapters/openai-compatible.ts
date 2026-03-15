/**
 * OpenAI-compatible adapter — works with OpenAI, Ollama, Groq, and any
 * provider that implements the /v1/chat/completions endpoint.
 *
 * Uses raw fetch (zero dependencies).
 */

import { calculateTokenCost } from '@/lib/token-pricing'
import type {
  InferenceAdapter,
  CompletionRequest,
  CompletionResponse,
} from '../inference-adapter'

/** Well-known base URLs */
const KNOWN_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
  groq: 'https://api.groq.com/openai/v1',
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OpenAIResponse {
  id: string
  choices: Array<{
    index: number
    message: { role: 'assistant'; content: string }
    finish_reason: 'stop' | 'length' | string | null
  }>
  model: string
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export class OpenAICompatibleAdapter implements InferenceAdapter {
  readonly provider: string
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(provider: string, apiKey: string, baseUrl?: string) {
    this.provider = provider
    this.apiKey = apiKey
    this.baseUrl = (baseUrl || KNOWN_ENDPOINTS[provider] || '').replace(/\/+$/, '')
    if (!this.baseUrl) {
      throw new Error(`No base URL for provider "${provider}". Set LLM_BASE_URL.`)
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startMs = Date.now()
    const messages: OpenAIMessage[] = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
    }
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.responseFormat === 'json') {
      body.response_format = { type: 'json_object' }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    // Ollama doesn't need auth; others do
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      throw new Error(`${this.provider} API error (${res.status}): ${errText}`)
    }

    const data = await res.json() as OpenAIResponse
    const choice = data.choices[0]
    if (!choice) throw new Error(`${this.provider} returned no choices`)

    const text = choice.message.content ?? ''
    const inputTokens = data.usage?.prompt_tokens ?? 0
    const outputTokens = data.usage?.completion_tokens ?? 0
    const latencyMs = Date.now() - startMs

    // Prefix model with provider for cost lookup (e.g. "groq/llama-3.1-8b-instant")
    const costModel = data.model.includes('/') ? data.model : `${this.provider}/${data.model}`
    const cost = calculateTokenCost(costModel, inputTokens, outputTokens)

    return {
      text,
      tokenCount: { input: inputTokens, output: outputTokens },
      cost,
      latencyMs,
      model: data.model,
      stopReason: choice.finish_reason ?? undefined,
    }
  }
}
