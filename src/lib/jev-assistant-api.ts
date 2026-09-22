import { z } from 'zod'
import { JEV_API_DRAFT_SCHEMA, parseJevApiDraft } from '@/lib/jev-assistant-api-schema'
import { jevAssistantModel } from '@/lib/jev-assistant-config'
import { JevAssistantProviderError } from '@/lib/jev-assistant-error'
import { JEV_ASSISTANT_SYSTEM_PROMPT } from '@/lib/jev-assistant-prompt'

type ApiProvider = 'anthropic' | 'openai'
const fail = (code: string, status: 429 | 502 | 503 | 504 = 502) => new JevAssistantProviderError(`JEV_ASSISTANT_${code}`, status)
const block = z.object({ type: z.string(), text: z.string().optional() })
const envelope = z.object({
  status: z.string().optional(), stop_reason: z.string().nullable().optional(),
  content: z.array(block).optional(),
  output: z.array(z.object({ type: z.string(), content: z.array(block).optional() })).optional(),
})

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw fail('INVALID_OUTPUT')
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 1_000_000) { await reader.cancel(); throw fail('OUTPUT_LIMIT') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function requestDraft(kind: ApiProvider, prompt: string, key: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(60_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const system = `${JEV_ASSISTANT_SYSTEM_PROMPT}\nReturn questions as an array. Fill only the chosen type’s criteria; unused strings must be empty and unused lists must be [].`
  const anthropic = kind === 'anthropic'
  const body = anthropic ? {
    model: jevAssistantModel(kind), max_tokens: 6000, system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: { type: 'json_schema', schema: JEV_API_DRAFT_SCHEMA } },
  } : {
    model: jevAssistantModel(kind), max_output_tokens: 6000, store: false,
    instructions: system, input: prompt,
    text: { format: { type: 'json_schema', name: 'jev_setup', strict: true, schema: JEV_API_DRAFT_SCHEMA } },
  }
  try {
    const response = await fetch(anthropic ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/responses', {
      method: 'POST', signal: combined, redirect: 'error',
      headers: anthropic ? { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
        : { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 401 || response.status === 403) throw fail('AUTH', 503)
      if (response.status === 429) throw fail('RATE_LIMITED', 429)
      throw fail(response.status >= 500 ? 'TEMPORARY_ERROR' : 'PROVIDER_ERROR')
    }
    const result = envelope.parse(await boundedJson(response))
    const blocks = anthropic ? result.content ?? [] : (result.output ?? []).flatMap((item) => item.content ?? [])
    if (result.stop_reason === 'refusal' || blocks.some((item) => item.type === 'refusal')) throw fail('REFUSED')
    if (anthropic ? result.stop_reason !== 'end_turn' : result.status !== 'completed') throw fail('INVALID_OUTPUT')
    const text = blocks.filter((item) => item.type === (anthropic ? 'text' : 'output_text')).map((item) => item.text ?? '').join('')
    return parseJevApiDraft(JSON.parse(text))
  } catch (error) {
    if (signal?.aborted) throw fail('CANCELLED', 504)
    if (timeout.aborted) throw fail('TIMEOUT', 504)
    if (error instanceof JevAssistantProviderError) throw error
    if (error instanceof SyntaxError || error instanceof z.ZodError) throw fail('INVALID_OUTPUT')
    throw fail('TEMPORARY_ERROR')
  }
}

export async function generateJevApiDraft(kind: ApiProvider, prompt: string, signal?: AbortSignal) {
  const key = (kind === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY)?.trim()
  if (!key) throw fail('UNAVAILABLE', 503)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw fail('CANCELLED', 504)
    try { return await requestDraft(kind, prompt, key, signal) }
    catch (error) {
      const retryable = error instanceof JevAssistantProviderError && ['JEV_ASSISTANT_TEMPORARY_ERROR', 'JEV_ASSISTANT_TIMEOUT', 'JEV_ASSISTANT_RATE_LIMITED'].includes(error.code)
      if (!retryable || attempt === 1 || signal?.aborted) throw error
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
        const timer = setTimeout(done, 500)
        signal?.addEventListener('abort', done, { once: true })
      })
    }
  }
  throw fail('PROVIDER_ERROR')
}
