import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'
import { parseGatewayHistoryTranscript, parseJsonlTranscript } from '@/lib/transcript-parser'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'

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

  const { searchParams } = new URL(request.url)
  const sessionKey = searchParams.get('key') || ''
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)

  if (!sessionKey) {
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

    // Extract agent name from session key (e.g. "agent:jarv:main" -> "jarv")
    const agentName = extractAgentName(sessionKey)
    if (!agentName) {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Could not determine agent from session key' })
    }

    // Look up the sessionId from the agent's sessions.json
    const sessionsFile = path.join(stateDir, 'agents', agentName, 'sessions', 'sessions.json')
    if (!existsSync(sessionsFile)) {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Agent sessions file not found' })
    }

    let sessionsData: Record<string, any>
    try {
      sessionsData = JSON.parse(readFileSync(sessionsFile, 'utf-8'))
    } catch {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Could not parse sessions.json' })
    }

    const sessionEntry = sessionsData[sessionKey]
    if (!sessionEntry?.sessionId) {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Session not found in sessions.json' })
    }

    const sessionId = sessionEntry.sessionId
    const jsonlPath = path.join(stateDir, 'agents', agentName, 'sessions', `${sessionId}.jsonl`)
    if (!existsSync(jsonlPath)) {
      return NextResponse.json({ messages: [], source: 'gateway', error: 'Session JSONL file not found' })
    }

    // Read and parse the JSONL file
    const raw = readFileSync(jsonlPath, 'utf-8')
    const messages = parseJsonlTranscript(raw, limit)

    return NextResponse.json({ messages, source: 'gateway' })
  } catch (err: any) {
    logger.warn({ err, sessionKey }, 'Gateway session transcript read failed')
    return NextResponse.json({ messages: [], source: 'gateway', error: 'Failed to read session transcript' })
  }
}

function extractAgentName(sessionKey: string): string | null {
  const parts = sessionKey.split(':')
  if (parts.length >= 2 && parts[0] === 'agent') {
    return parts[1]
  }
  return null
}

export const dynamic = 'force-dynamic'
