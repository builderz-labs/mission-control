import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { listWorkspacesForTenant } from '@/lib/workspaces'
import { validateBody, createWorkspaceSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const tenantId = auth.user.tenant_id ?? 1
    const workspaces = listWorkspacesForTenant(db, tenantId)
    return NextResponse.json({
      workspaces,
      active_workspace_id: auth.user.workspace_id,
      tenant_id: tenantId,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch workspaces' }, { status: 500 })
  }
}

/**
 * POST /api/workspaces - Create a new workspace
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const tenantId = auth.user.tenant_id ?? 1
    const validated = await validateBody(request, createWorkspaceSchema)
    if ('error' in validated) return validated.error
    const { name, slug, brand, isolation } = validated.data

    if (name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const resolvedSlug = (slug || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    if (!resolvedSlug) {
      return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
    }

    // Check uniqueness
    const existing = db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(resolvedSlug)
    if (existing) {
      return NextResponse.json({ error: 'Workspace slug already exists' }, { status: 409 })
    }

    const now = Math.floor(Date.now() / 1000)
    const result = db.prepare(
      'INSERT INTO workspaces (slug, name, tenant_id, brand, isolation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(resolvedSlug, name.trim(), tenantId, brand ?? null, isolation ?? 'shared', now, now)

    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(result.lastInsertRowid)

    logAuditEvent({
      action: 'workspace_created',
      actor: auth.user.username,
      actor_id: auth.user.id,
      target_type: 'workspace',
      target_id: Number(result.lastInsertRowid),
      detail: { name: name.trim(), slug: resolvedSlug, brand: brand ?? null, isolation: isolation ?? 'shared' },
    })

    return NextResponse.json({ workspace }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/workspaces error')
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
  }
}
