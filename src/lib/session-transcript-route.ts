import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { readLimiter } from '@/lib/rate-limit'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'
import { readClaudeTranscript } from '@/lib/claude-transcript'
import { readCodexTranscript } from '@/lib/codex-transcript'
import { readOpenCodeTranscript } from '@/lib/opencode-transcript'
import { readHermesTranscript, readHermesTranscriptFromDbPath } from '@/lib/hermes-transcript'
import { readKindTranscript } from '@/lib/session-transcript-read'
import { getDatabase } from '@/lib/db'
import { archiveSessionTranscript } from '@/lib/session-archive'
import { readArchivedTranscript } from '@/lib/session-archive-index'
import { SESSION_ID_RE } from '@/lib/jsonl-tail'
import type { TranscriptMessage } from '@/lib/session-transcript-types'

const KINDS = new Set(['claude-code', 'codex-cli', 'hermes', 'opencode', 'grok', 'kimi'])

function hostTranscript(kind: string, sessionId: string, limit: number): TranscriptMessage[] {
  return readKindTranscript(kind, sessionId, limit)
}

function maybeArchive(kind: string, sessionId: string, _live: boolean, hostMessages: TranscriptMessage[]): void {
  if (hostMessages.length === 0) return
  try {
    const lastUser = [...hostMessages].reverse().find((message) => message.role === 'user')
    const lastText = lastUser?.parts.find((part) => part.type === 'text')
    archiveSessionTranscript({
      kind,
      sessionId,
      lastUserPrompt: lastText && lastText.type === 'text' ? lastText.text : null,
      lastActivity: Date.now(),
      messages: hostMessages,
    })
  } catch { /* best-effort archive */ }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDenied = denyUnscopedResourceForStrictWorkspace(
    auth.user, 'session_transcripts', new URL(request.url).pathname,
  )
  if (isolationDenied) return isolationDenied
  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const kind = searchParams.get('kind') || ''
    const sessionId = searchParams.get('id') || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '80', 10), 200)
    const live = searchParams.get('live') === '1'
    if (!SESSION_ID_RE.test(sessionId) || !KINDS.has(kind)) {
      return NextResponse.json({ error: 'kind and id are required' }, { status: 400 })
    }
    const hostMessages = hostTranscript(kind, sessionId, limit)
    maybeArchive(kind, sessionId, live, hostMessages)
    const messages = hostMessages.length > 0
      ? hostMessages
      : readArchivedTranscript(kind, sessionId, limit, getDatabase())
    return NextResponse.json({ messages })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/sessions/transcript error')
    return NextResponse.json({ error: 'Failed to fetch transcript' }, { status: 500 })
  }
}

export const __testables = {
  readHermesTranscriptFromDbPath,
  readOpenCodeTranscript,
  readClaudeTranscript,
  readCodexTranscript,
}
