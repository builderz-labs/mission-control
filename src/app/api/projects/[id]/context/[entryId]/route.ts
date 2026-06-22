import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { findProjectInScope, parseProjectId } from '@/lib/creative-cms'

/**
 * DELETE /api/projects/[id]/context/[entryId]
 *
 * The shared handoff contract marks context-entry deletion as "only if
 * explicitly enabled" — the route is wired (admin role required, not just
 * operator) but UIs that surface it should be cautious about exposing it
 * to non-admin agents.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null
    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]/context/[entryId]',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id, entryId: entryIdRaw } = await params
    const projectId = parseProjectId(id)
    const entryId = Number.parseInt(entryIdRaw, 10)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    if (!Number.isFinite(entryId) || entryId <= 0) {
      return NextResponse.json({ error: 'Invalid entry ID' }, { status: 400 })
    }

    const project = findProjectInScope(db, projectId, workspaceId, tenantId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const removed = db
      .prepare(`DELETE FROM project_context_entries WHERE id = ? AND project_id = ?`)
      .run(entryId, projectId)
    if (removed.changes === 0) {
      return NextResponse.json({ error: 'Context entry not found' }, { status: 404 })
    }

    return NextResponse.json({ id: entryId, deleted: true })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'DELETE /api/projects/[id]/context/[entryId] error')
    return NextResponse.json({ error: 'Failed to delete context entry' }, { status: 500 })
  }
}
