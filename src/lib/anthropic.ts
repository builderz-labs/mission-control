/**
 * Server-side Anthropic helper — shared key resolution + a thin messages.create
 * wrapper used by background jobs (e.g. Atlas weekly reflection) that need to
 * call Claude outside an HTTP request.
 *
 * Key resolution matches the `/api/v1/messages` proxy: prefer
 * OPENCLAW_STATE_DIR/.env (set via MC Settings → Integrations → Anthropic),
 * then fall back to process.env.ANTHROPIC_API_KEY.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { config } from './config'
import { logger } from './logger'

const ANTHROPIC_API_BASE = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'
const OPENCLAW_ENV = process.env.OPENCLAW_STATE_DIR ? `${process.env.OPENCLAW_STATE_DIR}/.env` : null

export async function getAnthropicKey(): Promise<string | null> {
  if (OPENCLAW_ENV) {
    try {
      const raw = await readFile(OPENCLAW_ENV, 'utf-8')
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('ANTHROPIC_API_KEY=')) {
          const val = trimmed.slice('ANTHROPIC_API_KEY='.length).trim()
          if (val) return val
        }
      }
    } catch { /* file may not exist yet */ }
  }
  return process.env.ANTHROPIC_API_KEY || null
}

async function appendTokenRecord(record: object): Promise<void> {
  try {
    await mkdir(dirname(config.tokensPath), { recursive: true })
    let existing: object[] = []
    try {
      existing = JSON.parse(await readFile(config.tokensPath, 'utf-8'))
    } catch { /* file may not exist */ }
    existing.push(record)
    await writeFile(config.tokensPath, JSON.stringify(existing, null, 2))
  } catch (err) {
    logger.warn({ err }, 'anthropic helper: failed to append token record (non-fatal)')
  }
}

export interface AnthropicCallResult {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
}

/**
 * Call Claude with a single system + messages payload. Returns null when no API
 * key is configured (callers should fall back gracefully). Throws on upstream
 * errors so callers can record the failure.
 */
export async function callAnthropic(opts: {
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  model?: string
  maxTokens?: number
  agentName?: string
  source?: string
  workspaceId?: number
  timeoutMs?: number
}): Promise<AnthropicCallResult | null> {
  const apiKey = await getAnthropicKey()
  if (!apiKey) return null

  const model = opts.model || process.env.MC_ATLAS_MODEL || 'claude-opus-4-8'
  const startMs = Date.now()

  const resp = await fetch(`${ANTHROPIC_API_BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.system ? { system: opts.system } : {}),
      messages: opts.messages,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  })

  const body = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const msg = (body as any)?.error?.message || `HTTP ${resp.status}`
    throw new Error(`Anthropic call failed: ${msg}`)
  }

  const text = Array.isArray((body as any).content)
    ? (body as any).content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n').trim()
    : ''
  const usage = (body as any).usage || {}
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0

  await appendTokenRecord({
    id: (body as any).id || `mc-${Date.now()}`,
    model: (body as any).model || model,
    agentName: opts.agentName || 'Atlas',
    source: opts.source || 'atlas-reflection',
    timestamp: Date.now(),
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    durationMs: Date.now() - startMs,
    workspaceId: opts.workspaceId ?? 1,
  })

  return { text, model: (body as any).model || model, inputTokens, outputTokens }
}
