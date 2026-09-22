import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'node:fs'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'
import { readLimiter } from '@/lib/rate-limit'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'
import { parseGatewayHistoryTranscript, parseJsonlTranscript } from '@/lib/transcript-parser'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import { SESSION_ID_RE } from '@/lib/jsonl-tail'
import { resolveWithin } from '@/lib/safe-home-path'
import { extractAgentName, GATEWAY_KEY_RE } from '@/lib/gateway-session-key'

/**
 * GET /api/sessions/transcript/gateway?key=<session-key>&limit=50
 *
 * Reads the JSONL transcript file for a gateway session directly from disk.
 * OpenClaw stores session transcripts at:
 *   {OPENCLAW_STATE_DIR}/agents/{agent}/sessions/{sessionId}.jsonl
 *
 * The session key (e.g. "agent:jarv:cron:task-name") is used to look up
 * the sessionId from the agent's sessions.json, then the JSONL file is read.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDenied = denyUnscopedResourceForStrictWorkspace(auth.user, 'session_transcripts', new URL(request.url).pathname)
  if (isolationDenied) return isolationDenied
  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  const { searchParams } = new URL(request.url)
  const sessionKey = searchParams.get('key') || ''
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)

  if (!sessionKey || !GATEWAY_KEY_RE.test(sessionKey) || sessionKey.includes('..')) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 })
  }

  const stateDir = config.openclawStateDir
  if (!stateDir) {
    return NextResponse.json({ messages: [], source: 'gateway', error: 'OPENCLAW_STATE_DIR not configured' })
  }

  try {
    try {
      const history = await callOpenClawGateway<{ messages?: unknown[] }>(
        'chat.history',
        { sessionKey, limit },
        15000,
      )
      const liveMessages = parseGatewayHistoryTranscript(Array.isArray(history?.messages) ? history.messages : [], limit)
      if (liveMessages.length > 0) {
        return NextResponse.json({ messages: liveMessages, source: 'gateway-rpc' })
      }
    } catch (rpcErr) {
      logger.warn({ err: rpcErr, sessionKey }, 'Gateway chat.history failed, falling back to disk transcript')
    }

    const agentName = extractAgentName(sessionKey)
    if (!agentName) {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Could not determine agent from session key' })
    }

    const sessionsFile = resolveWithin(stateDir, 'agents', agentName, 'sessions', 'sessions.json')
    if (!sessionsFile || !existsSync(sessionsFile)) {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Agent sessions file not found' })
    }

    let sessionsData: Record<string, unknown>
    try {
      const parsed = JSON.parse(readFileSync(sessionsFile, 'utf-8')) as unknown
      sessionsData = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Could not parse sessions.json' })
    }

    const sessionEntry = sessionsData[sessionKey]
    const sessionId = sessionEntry && typeof sessionEntry === 'object' && !Array.isArray(sessionEntry)
      ? (sessionEntry as { sessionId?: unknown }).sessionId
      : null
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Session not found in sessions.json' })
    }

    const jsonlPath = resolveWithin(stateDir, 'agents', agentName, 'sessions', `${sessionId}.jsonl`)
    if (!jsonlPath || !existsSync(jsonlPath)) {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Session JSONL file not found' })
    }

    // Read and parse the JSONL file
    const raw = readFileSync(jsonlPath, 'utf-8')
    const messages = parseJsonlTranscript(raw, limit)

    return NextResponse.json({ messages, source: 'gateway' })
  } catch (err: unknown) {
    logger.warn({ err, sessionKey }, 'Gateway session transcript read failed')
    return NextResponse.json({ messages: [], source: 'gateway', error: 'Failed to read session transcript' })
  }
}

export const dynamic = 'force-dynamic'
