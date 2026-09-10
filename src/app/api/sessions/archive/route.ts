import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'
import { archiveListedSessions } from '@/lib/session-archive'
import { indexSessionArchives } from '@/lib/session-archive-index'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDenied = denyUnscopedResourceForStrictWorkspace(auth.user, 'local_sessions', new URL(request.url).pathname)
  if (isolationDenied) return isolationDenied
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({})) as { sessions?: Array<Record<string, unknown>> }
    const sessions = Array.isArray(body.sessions) ? body.sessions.slice(0, 80) : []
    const written = archiveListedSessions(sessions)
    const indexed = indexSessionArchives(getDatabase(), sessions)
    return NextResponse.json({ ok: true, written, indexed })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/sessions/archive error')
    return NextResponse.json({ error: 'Archive failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
