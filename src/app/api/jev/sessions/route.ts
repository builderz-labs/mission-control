import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { validateBoundedBody } from '@/lib/bounded-validation'
import { logAuditEvent } from '@/lib/db'
import { jevErrorResponse } from '@/lib/jev-route-error'
import { assertJevProject } from '@/lib/jev-repository'
import { jevPrincipal } from '@/lib/jev-session-access'
import {
  listJevSetupSessions,
} from '@/lib/jev-setup-session-repository'
import { createJevSetupSessionWithInput } from '@/lib/jev-setup-session-create'
import { createJevSetupSessionSchema } from '@/lib/jev-setup-session-validation'
import { mutationLimiter, readLimiter } from '@/lib/rate-limit'

function integerParam(value: string | null, fallback: number, maximum: number): number | null {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = readLimiter(request)
  if (limited) return limited
  const query = new URL(request.url).searchParams
  const projectId = query.has('projectId') ? integerParam(query.get('projectId'), 0, 2_147_483_647) : undefined
  const limit = integerParam(query.get('limit'), 50, 100)
  const offset = integerParam(query.get('offset'), 0, 1_000_000)
  if (projectId === null || projectId === 0 || limit === null || limit === 0 || offset === null) {
    return NextResponse.json({ error: 'Invalid session list query' }, { status: 400 })
  }

  try {
    if (projectId) assertJevProject(auth.user.workspace_id, auth.user.tenant_id, projectId)
    const sessions = listJevSetupSessions(auth.user.workspace_id, auth.user.tenant_id, {
      projectId,
      includeArchived: query.get('includeArchived') === 'true',
      limit,
      offset,
    })
    return NextResponse.json({ sessions })
  } catch (error) {
    return jevErrorResponse(error, 'list Jev setup sessions')
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = mutationLimiter(request)
  if (limited) return limited
  const validated = await validateBoundedBody(request, createJevSetupSessionSchema, {
    maxBytes: 80_000, maxDepth: 8, label: 'Session request',
  })
  if ('error' in validated) return validated.error

  try {
    const session = createJevSetupSessionWithInput(validated.data, {
      workspaceId: auth.user.workspace_id,
      tenantId: auth.user.tenant_id,
      userId: auth.user.id,
      principal: jevPrincipal(auth.user),
    })
    logAuditEvent({
      action: 'jev_setup_session_created',
      actor: auth.user.username,
      actor_id: auth.user.id,
      target_type: 'jev_setup_session',
      detail: { session_id: session.id, project_id: session.project_id },
      workspace_id: auth.user.workspace_id,
    })
    return NextResponse.json({ session }, { status: 201 })
  } catch (error) {
    return jevErrorResponse(error, 'create Jev setup session')
  }
}
