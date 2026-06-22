import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { findProjectInScope, parseProjectId } from '@/lib/creative-cms'

/**
 * DELETE /api/projects/[id]/assets/[assetId]
 *
 * Removes the asset row. Does NOT delete the file from Cloudinary — that has
 * to happen out-of-band (or via a future webhook) so we don't accidentally
 * orphan files that are still referenced elsewhere (e.g. by branding logos).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const auth = requireRole(request, 'operator')
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
      route: '/api/projects/[id]/assets/[assetId]',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id, assetId: assetIdRaw } = await params
    const projectId = parseProjectId(id)
    const assetId = Number.parseInt(assetIdRaw, 10)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    if (!Number.isFinite(assetId) || assetId <= 0) {
      return NextResponse.json({ error: 'Invalid asset ID' }, { status: 400 })
    }

    const project = findProjectInScope(db, projectId, workspaceId, tenantId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const removed = db
      .prepare(`DELETE FROM project_assets WHERE id = ? AND project_id = ?`)
      .run(assetId, projectId)

    if (removed.changes === 0) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    // Detach the asset if it was the active logo. Foreign-key cascade would
    // be wrong here — the branding profile should survive losing its logo.
    db.prepare(
      `UPDATE project_branding SET logo_asset_id = NULL, updated_at = unixepoch() WHERE logo_asset_id = ?`
    ).run(assetId)

    return NextResponse.json({ id: assetId, deleted: true })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'DELETE /api/projects/[id]/assets/[assetId] error')
    return NextResponse.json({ error: 'Failed to delete asset' }, { status: 500 })
  }
}
