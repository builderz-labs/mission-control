/**
 * POST /api/llm/chat — LLM proxy for the agent fleet.
 *
 * Agents call this instead of Anthropic directly. Benefits:
 *   - Swap models fleet-wide from MC integrations panel (one place)
 *   - Spend tracking per agent in mission-control-tokens.json
 *   - Agents only need their MC agent API key — no Anthropic key per agent
 *
 * Request (x-api-key: mca_<key> header required):
 *   { model?, messages, max_tokens?, system?, agent_name? }
 *
 * Response: Anthropic message response (passthrough).
 *
 * Key resolution order:
 *   1. ANTHROPIC_API_KEY in /app/.data/openclaw/.env (set via MC integrations panel)
 *   2. ANTHROPIC_API_KEY in process.env
 *   3. 403 — key not configured
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { config } from '@/lib/config'

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const ANTHROPIC_API_BASE = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'
const OPENCLAW_ENV = process.env.OPENCLAW_STATE_DIR
  ? `${process.env.OPENCLAW_STATE_DIR}/.env`
  : null

async function getAnthropicKey(): Promise<string | null> {
  // 1. Check openclaw state dir (set via MC integrations panel)
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
  // 2. Process env fallback
  return process.env.ANTHROPIC_API_KEY || null
}

async function appendTokenRecord(record: object): Promise<void> {
  try {
    await mkdir(dirname(config.tokensPath), { recursive: true })
    let existing: object[] = []
    try {
      const raw = await readFile(config.tokensPath, 'utf-8')
      existing = JSON.parse(raw)
    } catch { /* file may not exist */ }
    existing.push(record)
    await writeFile(config.tokensPath, JSON.stringify(existing, null, 2))
  } catch (err) {
    logger.warn({ err }, 'llm-proxy: failed to append token record (non-fatal)')
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apiKey = await getAnthropicKey()
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Anthropic API key not configured — set it in MC Settings → Integrations → Anthropic' },
      { status: 403 }
    )
  }

  let body: {
    model?: string
    messages: Array<{ role: string; content: string }>
    max_tokens?: number
    system?: string
    agent_name?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages array required' }, { status: 400 })
  }

  const model = body.model || DEFAULT_MODEL
  const agentName = body.agent_name || auth.user?.display_name || auth.user?.username || 'unknown'
  const startMs = Date.now()

  const anthropicBody: Record<string, unknown> = {
    model,
    messages: body.messages,
    max_tokens: body.max_tokens ?? 4096,
  }
  if (body.system) anthropicBody.system = body.system

  let anthropicResp: Response
  try {
    anthropicResp = await fetch(`${ANTHROPIC_API_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(anthropicBody),
      signal: AbortSignal.timeout(600_000),
    })
  } catch (err) {
    logger.error({ err }, 'llm-proxy: upstream request failed')
    return NextResponse.json({ error: 'Upstream request failed' }, { status: 502 })
  }

  const responseBody = await anthropicResp.json()
  const durationMs = Date.now() - startMs

  // Log usage
  if (anthropicResp.ok && responseBody.usage) {
    const { input_tokens, output_tokens } = responseBody.usage
    const total = (input_tokens ?? 0) + (output_tokens ?? 0)
    await appendTokenRecord({
      id: responseBody.id || `llm-proxy-${Date.now()}`,
      model,
      agentName,
      source: 'llm-proxy',
      timestamp: Date.now(),
      inputTokens: input_tokens ?? 0,
      outputTokens: output_tokens ?? 0,
      totalTokens: total,
      durationMs,
      workspaceId: auth.user?.workspace_id ?? 1,
    })
    logger.info({ model, agentName, input_tokens, output_tokens, durationMs }, 'llm-proxy: request complete')
  } else if (!anthropicResp.ok) {
    logger.warn({ status: anthropicResp.status, body: responseBody }, 'llm-proxy: upstream error')
  }

  return NextResponse.json(responseBody, { status: anthropicResp.status })
}
