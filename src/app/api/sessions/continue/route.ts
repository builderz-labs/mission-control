import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { heavyLimiter } from '@/lib/rate-limit'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'
import { continueEffort, continueModelId } from '@/lib/session-continue-model'
import { parsePermissionMode } from '@/lib/permission-connector'
import { ContinueBusyError, isContinueKind, runSessionContinue } from '@/lib/session-continue-run'
import { isSessionId } from '@/lib/session-handoff'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDenied = denyUnscopedResourceForStrictWorkspace(auth.user, 'local_sessions', new URL(request.url).pathname)
  if (isolationDenied) return isolationDenied
  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const kind = typeof body.kind === 'string' ? body.kind : ''
    const sessionId = typeof body.id === 'string' ? body.id.trim() : ''
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (!isSessionId(sessionId)) return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
    if (!isContinueKind(kind)) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
    if (!prompt || prompt.length > 6000) {
      return NextResponse.json({ error: 'prompt is required (max 6000 chars)' }, { status: 400 })
    }
    const reply = await runSessionContinue({
      kind,
      sessionId,
      prompt,
      modelId: continueModelId(kind, typeof body.model === 'string' ? body.model : '', body.fast === true),
      effort: continueEffort(kind, typeof body.effort === 'string' ? body.effort : ''),
      permissionMode: parsePermissionMode(body.permissionMode),
    })
    return NextResponse.json({
      ok: true,
      reply: reply || 'Session continued, but no text response was returned.',
    })
  } catch (error: unknown) {
    if (error instanceof ContinueBusyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/sessions/continue error')
    const message = error instanceof Error ? error.message : 'Failed to continue session'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
