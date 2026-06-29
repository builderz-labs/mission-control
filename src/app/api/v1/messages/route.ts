/**
 * POST /api/v1/messages — Anthropic-compatible proxy.
 *
 * Drop-in replacement for api.anthropic.com/v1/messages.
 * Agents change only base_url + api_key — all SDK logic stays identical.
 *
 * Usage (Python):
 *   client = anthropic.Anthropic(
 *     base_url="https://mc.str-agents.com/api",
 *     api_key=os.environ["MC_API_KEY"],  # mca_...
 *   )
 *   # All messages.create() calls work unchanged.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { config } from '@/lib/config'

const ANTHROPIC_API_BASE = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'
const OPENCLAW_ENV = process.env.OPENCLAW_STATE_DIR
  ? `${process.env.OPENCLAW_STATE_DIR}/.env`
  : null

async function getAnthropicKey(): Promise<string | null> {
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
      const raw = await readFile(config.tokensPath, 'utf-8')
      existing = JSON.parse(raw)
    } catch { /* file may not exist */ }
    existing.push(record)
    await writeFile(config.tokensPath, JSON.stringify(existing, null, 2))
  } catch (err) {
    logger.warn({ err }, 'v1/messages proxy: failed to append token record (non-fatal)')
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

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Pass through all headers the SDK might send (beta features etc.) except auth
  const forwardHeaders: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json',
  }
  const betaHeader = request.headers.get('anthropic-beta')
  if (betaHeader) forwardHeaders['anthropic-beta'] = betaHeader

  const startMs = Date.now()

  let anthropicResp: Response
  try {
    anthropicResp = await fetch(`${ANTHROPIC_API_BASE}/v1/messages`, {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    })
  } catch (err) {
    logger.error({ err }, 'v1/messages proxy: upstream request failed')
    return NextResponse.json({ error: 'Upstream request failed' }, { status: 502 })
  }

  const responseBody = await anthropicResp.json()
  const durationMs = Date.now() - startMs

  if (anthropicResp.ok && responseBody.usage) {
    const { input_tokens, output_tokens } = responseBody.usage
    const agentName = auth.user?.display_name || auth.user?.username || 'unknown'
    await appendTokenRecord({
      id: responseBody.id || `proxy-${Date.now()}`,
      model: responseBody.model || body.model || 'unknown',
      agentName,
      source: 'v1-messages-proxy',
      timestamp: Date.now(),
      inputTokens: input_tokens ?? 0,
      outputTokens: output_tokens ?? 0,
      totalTokens: (input_tokens ?? 0) + (output_tokens ?? 0),
      durationMs,
      workspaceId: auth.user?.workspace_id ?? 1,
    })
    logger.info({ model: body.model, agentName, input_tokens, output_tokens, durationMs }, 'v1/messages proxy: ok')
  }

  return NextResponse.json(responseBody, { status: anthropicResp.status })
}
