import { NextRequest, NextResponse } from 'next/server'
import { getAllGatewaySessions } from '@/lib/sessions'
import { syncClaudeSessions } from '@/lib/claude-sessions'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import { mutationLimiter, readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'
import { projectSlugOf } from '@/lib/chat-session-identity'
import { collectLocalSessions, mapGatewaySessions } from '@/lib/session-list-merge'
import { dedupeAndSortSessions, parseSessionLimit } from '@/lib/session-list-balance'
import { scheduleSessionArchive } from '@/lib/session-archive-schedule'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDenied = denyUnscopedResourceForStrictWorkspace(auth.user, 'local_sessions', new URL(request.url).pathname)
  if (isolationDenied) return isolationDenied
  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const mappedGatewaySessions = mapGatewaySessions(getAllGatewaySessions())
    let localMerged = collectLocalSessions()
    const hasClaude = localMerged.some((session) => session.kind === 'claude-code')
    if (!hasClaude) {
      await syncClaudeSessions()
      localMerged = collectLocalSessions()
    } else {
      void syncClaudeSessions()
    }
    if (mappedGatewaySessions.length === 0 && localMerged.length === 0) {
      return NextResponse.json({ sessions: [] })
    }
    const search = new URL(request.url).searchParams
    const project = search.get('project')?.trim().toLowerCase() || ''
    const limit = parseSessionLimit(search.get('limit'))
    let merged = dedupeAndSortSessions([...mappedGatewaySessions, ...localMerged], limit)
    if (search.get('include') === 'archived') {
      try {
        const { listArchivedSessions } = await import('@/lib/session-archive-index')
        merged = dedupeAndSortSessions([...merged, ...listArchivedSessions(getDatabase(), project || undefined)])
      } catch (err) {
        logger.warn({ err }, 'Archived session merge skipped')
      }
    }
    if (project) {
      merged = merged.filter((session) => projectSlugOf(typeof session.workingDir === 'string' ? session.workingDir : null) === project)
    }
    scheduleSessionArchive(merged)
    return NextResponse.json({ sessions: merged })
  } catch (error) {
    logger.error({ err: error }, 'Sessions API error')
    return NextResponse.json(
      { sessions: [], error: 'Unable to load sessions' },
      { status: 500 },
    )
  }
}

const VALID_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
const VALID_VERBOSE_LEVELS = ['off', 'on', 'full'] as const
const VALID_REASONING_LEVELS = ['off', 'on', 'stream'] as const
const SESSION_KEY_RE = /^[a-zA-Z0-9:_.-]+$/

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDenied = denyUnscopedResourceForStrictWorkspace(auth.user, 'gateway_sessions', new URL(request.url).pathname)
  if (isolationDenied) return isolationDenied

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const body = await request.json()
    const { sessionKey } = body

    if (!sessionKey || !SESSION_KEY_RE.test(sessionKey)) {
      return NextResponse.json({ error: 'Invalid session key' }, { status: 400 })
    }

    let rpcMethod: string
    let rpcParams: Record<string, unknown>
    let logDetail: string

    switch (action) {
      case 'set-thinking': {
        const { level } = body
        if (!VALID_THINKING_LEVELS.includes(level)) {
          return NextResponse.json({ error: `Invalid thinking level. Must be: ${VALID_THINKING_LEVELS.join(', ')}` }, { status: 400 })
        }
        rpcMethod = 'session_setThinking'
        rpcParams = { sessionKey, level }
        logDetail = `Set thinking=${level} on ${sessionKey}`
        break
      }
      case 'set-verbose': {
        const { level } = body
        if (!VALID_VERBOSE_LEVELS.includes(level)) {
          return NextResponse.json({ error: `Invalid verbose level. Must be: ${VALID_VERBOSE_LEVELS.join(', ')}` }, { status: 400 })
        }
        rpcMethod = 'session_setVerbose'
        rpcParams = { sessionKey, level }
        logDetail = `Set verbose=${level} on ${sessionKey}`
        break
      }
      case 'set-reasoning': {
        const { level } = body
        if (!VALID_REASONING_LEVELS.includes(level)) {
          return NextResponse.json({ error: `Invalid reasoning level. Must be: ${VALID_REASONING_LEVELS.join(', ')}` }, { status: 400 })
        }
        rpcMethod = 'session_setReasoning'
        rpcParams = { sessionKey, level }
        logDetail = `Set reasoning=${level} on ${sessionKey}`
        break
      }
      case 'set-label': {
        const { label } = body
        if (typeof label !== 'string' || label.length > 100) {
          return NextResponse.json({ error: 'Label must be a string up to 100 characters' }, { status: 400 })
        }
        rpcMethod = 'session_setLabel'
        rpcParams = { sessionKey, label }
        logDetail = `Set label="${label}" on ${sessionKey}`
        break
      }
      default:
        return NextResponse.json({ error: 'Invalid action. Must be: set-thinking, set-verbose, set-reasoning, set-label' }, { status: 400 })
    }

    const result = await callOpenClawGateway(rpcMethod, rpcParams, 10_000)

    db_helpers.logActivity(
      'session_control',
      'session',
      0,
      auth.user.username,
      logDetail,
      { session_key: sessionKey, action }
    )

    return NextResponse.json({ success: true, action, sessionKey, result })
  } catch (error: unknown) {
    logger.error({ err: error }, 'Session POST error')
    const message = error instanceof Error ? error.message : 'Session action failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDenied = denyUnscopedResourceForStrictWorkspace(auth.user, 'gateway_sessions', new URL(request.url).pathname)
  if (isolationDenied) return isolationDenied

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()
    const { sessionKey } = body

    if (!sessionKey || !SESSION_KEY_RE.test(sessionKey)) {
      return NextResponse.json({ error: 'Invalid session key' }, { status: 400 })
    }

    const result = await callOpenClawGateway('session_delete', { sessionKey }, 10_000)

    db_helpers.logActivity(
      'session_control',
      'session',
      0,
      auth.user.username,
      `Deleted session ${sessionKey}`,
      { session_key: sessionKey, action: 'delete' }
    )

    return NextResponse.json({ success: true, sessionKey, result })
  } catch (error: unknown) {
    logger.error({ err: error }, 'Session DELETE error')
    const message = error instanceof Error ? error.message : 'Session deletion failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
