import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { validateBoundedBody } from '@/lib/bounded-validation'
import { logAuditEvent } from '@/lib/db'
import { jevErrorResponse } from '@/lib/jev-route-error'
import { canManageJevSession } from '@/lib/jev-session-access'
import {
  archiveJevSetupSession,
  getJevSetupSession,
  getLatestJevSetupRevision,
  updateJevSetupSession,
} from '@/lib/jev-setup-session-repository'
import { updateJevSetupSessionSchema } from '@/lib/jev-setup-session-validation'
import { mutationLimiter, readLimiter } from '@/lib/rate-limit'

type Context = { params: Promise<{ id: string }> }

async function sessionId(context: Context): Promise<string | null> {
  const parsed = z.string().uuid().safeParse((await context.params).id)
  return parsed.success ? parsed.data : null
}

export async function GET(request: NextRequest, context: Context) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = readLimiter(request)
  if (limited) return limited
  const id = await sessionId(context)
  if (!id) return NextResponse.json({ error: 'Invalid session identifier' }, { status: 400 })
  try {
    const session = getJevSetupSession(id, auth.user.workspace_id, auth.user.tenant_id)
    return NextResponse.json({ session, latestRevision: getLatestJevSetupRevision(session) })
  } catch (error) {
    return jevErrorResponse(error, 'read Jev setup session')
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = mutationLimiter(request)
  if (limited) return limited
  const validated = await validateBoundedBody(request, updateJevSetupSessionSchema, {
    maxBytes: 16_000, maxDepth: 8, label: 'Session request',
  })
  if ('error' in validated) return validated.error
  const id = await sessionId(context)
  if (!id) return NextResponse.json({ error: 'Invalid session identifier' }, { status: 400 })
  try {
    const current = getJevSetupSession(id, auth.user.workspace_id, auth.user.tenant_id)
    if (!canManageJevSession(auth.user, current)) {
      return NextResponse.json({ error: 'Session owner or administrator required' }, { status: 403 })
    }
    if (current.status === 'archived') {
      return NextResponse.json({ error: 'Archived sessions cannot be updated' }, { status: 409 })
    }
    const session = updateJevSetupSession(current, validated.data)
    logAuditEvent({
      action: 'jev_setup_session_updated', actor: auth.user.username, actor_id: auth.user.id,
      target_type: 'jev_setup_session',
      detail: { session_id: session.id, fields: Object.keys(validated.data) },
      workspace_id: auth.user.workspace_id,
    })
    return NextResponse.json({ session })
  } catch (error) {
    return jevErrorResponse(error, 'update Jev setup session')
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = mutationLimiter(request)
  if (limited) return limited
  const id = await sessionId(context)
  if (!id) return NextResponse.json({ error: 'Invalid session identifier' }, { status: 400 })
  try {
    const current = getJevSetupSession(id, auth.user.workspace_id, auth.user.tenant_id)
    if (!canManageJevSession(auth.user, current)) {
      return NextResponse.json({ error: 'Session owner or administrator required' }, { status: 403 })
    }
    const session = archiveJevSetupSession(current)
    logAuditEvent({
      action: 'jev_setup_session_archived', actor: auth.user.username, actor_id: auth.user.id,
      target_type: 'jev_setup_session', detail: { session_id: session.id },
      workspace_id: auth.user.workspace_id,
    })
    return NextResponse.json({ session })
  } catch (error) {
    return jevErrorResponse(error, 'archive Jev setup session')
  }
}
