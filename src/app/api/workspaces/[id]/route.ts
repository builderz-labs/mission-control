import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { validateBody, updateWorkspaceSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'

/**
 * GET /api/workspaces/[id] - Get a single workspace
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { id } = await params
    const tenantId = auth.user.tenant_id ?? 1

    const workspace = db.prepare(
      'SELECT * FROM workspaces WHERE id = ? AND tenant_id = ?'
    ).get(Number(id), tenantId)

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Include agent count
    const stats = db.prepare(
      'SELECT COUNT(*) as agent_count FROM agents WHERE workspace_id = ?'
    ).get(Number(id)) as { agent_count: number }

    return NextResponse.json({
      workspace: { ...(workspace as any), agent_count: stats.agent_count },
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/workspaces/[id] error')
    return NextResponse.json({ error: 'Failed to fetch workspace' }, { status: 500 })
  }
}

/**
 * PUT /api/workspaces/[id] - Update workspace name, brand, and isolation
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { id } = await params
    const tenantId = auth.user.tenant_id ?? 1
    const validated = await validateBody(request, updateWorkspaceSchema)
    if ('error' in validated) return validated.error
    const { name, brand, isolation } = validated.data

    if (name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const existing = db.prepare(
      'SELECT * FROM workspaces WHERE id = ? AND tenant_id = ?'
    ).get(Number(id), tenantId) as any

    if (!existing) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Omitted fields keep their stored values; brand: null explicitly clears it.
    const nextBrand = brand === undefined ? (existing.brand ?? null) : brand
    const nextIsolation = isolation === undefined ? (existing.isolation ?? 'shared') : isolation

    // Don't allow renaming the default workspace slug
    const now = Math.floor(Date.now() / 1000)
    db.prepare(
      'UPDATE workspaces SET name = ?, brand = ?, isolation = ?, updated_at = ? WHERE id = ? AND tenant_id = ?'
    ).run(name.trim(), nextBrand, nextIsolation, now, Number(id), tenantId)

    logAuditEvent({
      action: 'workspace_updated',
      actor: auth.user.username,
      actor_id: auth.user.id,
      target_type: 'workspace',
      target_id: Number(id),
      detail: {
        old_name: existing.name,
        new_name: name.trim(),
        old_brand: existing.brand ?? null,
        new_brand: nextBrand,
        old_isolation: existing.isolation ?? 'shared',
        new_isolation: nextIsolation,
      },
    })

    const updated = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(Number(id))
    return NextResponse.json({ workspace: updated })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/workspaces/[id] error')
    return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 })
  }
}

/**
 * DELETE /api/workspaces/[id] - Delete a workspace (moves agents to default workspace)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { id } = await params
    const tenantId = auth.user.tenant_id ?? 1
    const workspaceId = Number(id)

    const existing = db.prepare(
      'SELECT * FROM workspaces WHERE id = ? AND tenant_id = ?'
    ).get(workspaceId, tenantId) as any

    if (!existing) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    if (existing.slug === 'default') {
      return NextResponse.json({ error: 'Cannot delete the default workspace' }, { status: 400 })
    }

    // Find default workspace to reassign agents
    const defaultWs = db.prepare(
      "SELECT id FROM workspaces WHERE slug = 'default' AND tenant_id = ? LIMIT 1"
    ).get(tenantId) as { id: number } | undefined

    const fallbackId = defaultWs?.id ?? 1

    db.transaction(() => {
      // Reassign agents to default workspace
      const moved = db.prepare(
        'UPDATE agents SET workspace_id = ?, updated_at = ? WHERE workspace_id = ?'
      ).run(fallbackId, Math.floor(Date.now() / 1000), workspaceId)

      // Reassign users to default workspace
      db.prepare(
        'UPDATE users SET workspace_id = ?, updated_at = ? WHERE workspace_id = ?'
      ).run(fallbackId, Math.floor(Date.now() / 1000), workspaceId)

      // Reassign projects to default workspace
      db.prepare(
        'UPDATE projects SET workspace_id = ?, updated_at = ? WHERE workspace_id = ?'
      ).run(fallbackId, Math.floor(Date.now() / 1000), workspaceId)

      // Delete workspace
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId)

      logAuditEvent({
        action: 'workspace_deleted',
        actor: auth.user.username,
        actor_id: auth.user.id,
        target_type: 'workspace',
        target_id: workspaceId,
        detail: {
          name: existing.name,
          slug: existing.slug,
          agents_moved: (moved as any).changes,
          moved_to_workspace: fallbackId,
        },
      })
    })()

    return NextResponse.json({
      success: true,
      deleted: existing.name,
      agents_moved_to: fallbackId,
    })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/workspaces/[id] error')
    return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 })
  }
}
