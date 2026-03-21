import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import {
  ensureTenantWorkspaceAccess,
  ForbiddenError
} from '@/lib/workspaces'
import { normalizeProjectWorkflowMode, normalizeProjectWorkflowTemplate } from '@/lib/edict-workflow'

function normalizePrefix(input: string): string {
  const normalized = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return normalized.slice(0, 12)
}

function toProjectId(raw: string): number {
  const id = Number.parseInt(raw, 10)
  return Number.isFinite(id) ? id : NaN
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const tenantId = auth.user.tenant_id ?? 1
    const forwardedFor = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || null
    ensureTenantWorkspaceAccess(db, tenantId, workspaceId, {
      actor: auth.user.username,
      actorId: auth.user.id,
      route: '/api/projects/[id]',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })
    const { id } = await params
    const projectId = toProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    const projectScope = db.prepare(`
      SELECT p.id
      FROM projects p
      JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.id = ? AND p.workspace_id = ? AND w.tenant_id = ?
      LIMIT 1
    `).get(projectId, workspaceId, tenantId)
    if (!projectScope) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const row = db.prepare(`
      SELECT p.id, p.workspace_id, p.name, p.slug, p.description, p.ticket_prefix, p.ticket_counter, p.status,
             p.workflow_mode, p.workflow_template,
             p.github_repo, p.deadline, p.color, p.github_sync_enabled, p.github_labels_initialized, p.github_default_branch, p.created_at, p.updated_at,
             (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
             (SELECT GROUP_CONCAT(paa.agent_name) FROM project_agent_assignments paa WHERE paa.project_id = p.id) as assigned_agents_csv
      FROM projects p
      WHERE p.id = ? AND p.workspace_id = ?
    `).get(projectId, workspaceId) as Record<string, unknown> | undefined
    if (!row) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const project = {
      ...row,
      assigned_agents: row.assigned_agents_csv ? String(row.assigned_agents_csv).split(',') : [],
      assigned_agents_csv: undefined,
    }

    return NextResponse.json({ project })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'GET /api/projects/[id] error')
    return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
      route: '/api/projects/[id]',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })
    const { id } = await params
    const projectId = toProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    const projectScope = db.prepare(`
      SELECT p.id
      FROM projects p
      JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.id = ? AND p.workspace_id = ? AND w.tenant_id = ?
      LIMIT 1
    `).get(projectId, workspaceId, tenantId)
    if (!projectScope) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const current = db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`).get(projectId, workspaceId) as any
    if (!current) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (current.slug === 'general' && current.workspace_id === workspaceId && current.id === projectId) {
      const body = await request.json()
      if (body?.status === 'archived') {
        return NextResponse.json({ error: 'Default project cannot be archived' }, { status: 400 })
      }
    }

    const body = await request.json()
    const updates: string[] = []
    const paramsList: Array<string | number | null> = []

    if (typeof body?.name === 'string') {
      const name = body.name.trim()
      if (!name) return NextResponse.json({ error: 'Project name cannot be empty' }, { status: 400 })
      updates.push('name = ?')
      paramsList.push(name)
    }
    if (typeof body?.description === 'string') {
      updates.push('description = ?')
      paramsList.push(body.description.trim() || null)
    }
    if (typeof body?.ticket_prefix === 'string' || typeof body?.ticketPrefix === 'string') {
      const raw = String(body.ticket_prefix ?? body.ticketPrefix)
      const prefix = normalizePrefix(raw)
      if (!prefix) return NextResponse.json({ error: 'Invalid ticket prefix' }, { status: 400 })
      const conflict = db.prepare(`
        SELECT id FROM projects
        WHERE workspace_id = ? AND ticket_prefix = ? AND id != ?
      `).get(workspaceId, prefix, projectId)
      if (conflict) return NextResponse.json({ error: 'Ticket prefix already in use' }, { status: 409 })
      updates.push('ticket_prefix = ?')
      paramsList.push(prefix)
    }
    if (typeof body?.status === 'string') {
      const status = body.status === 'archived' ? 'archived' : 'active'
      updates.push('status = ?')
      paramsList.push(status)
    }
    if (body?.workflow_mode !== undefined || body?.workflow_template !== undefined) {
      const workflowMode = normalizeProjectWorkflowMode(body.workflow_mode ?? body.workflow_template)
      const workflowTemplate = normalizeProjectWorkflowTemplate(body.workflow_template ?? body.workflow_mode)
      updates.push('workflow_mode = ?')
      paramsList.push(workflowMode)
      updates.push('workflow_template = ?')
      paramsList.push(workflowTemplate)
    }
    if (body?.github_repo !== undefined) {
      updates.push('github_repo = ?')
      paramsList.push(typeof body.github_repo === 'string' ? body.github_repo.trim() || null : null)
    }
    if (body?.deadline !== undefined) {
      updates.push('deadline = ?')
      paramsList.push(typeof body.deadline === 'number' ? body.deadline : null)
    }
    if (body?.color !== undefined) {
      updates.push('color = ?')
      paramsList.push(typeof body.color === 'string' ? body.color.trim() || null : null)
    }
    if (body?.github_sync_enabled !== undefined) {
      updates.push('github_sync_enabled = ?')
      paramsList.push(body.github_sync_enabled ? 1 : 0)
    }
    if (body?.github_default_branch !== undefined) {
      updates.push('github_default_branch = ?')
      paramsList.push(typeof body.github_default_branch === 'string' ? body.github_default_branch.trim() || 'main' : 'main')
    }
    if (body?.github_labels_initialized !== undefined) {
      updates.push('github_labels_initialized = ?')
      paramsList.push(body.github_labels_initialized ? 1 : 0)
    }

    if (updates.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

    updates.push('updated_at = unixepoch()')
    db.prepare(`
      UPDATE projects
      SET ${updates.join(', ')}
      WHERE id = ? AND workspace_id = ?
    `).run(...paramsList, projectId, workspaceId)

    const project = db.prepare(`
      SELECT id, workspace_id, name, slug, description, ticket_prefix, ticket_counter, status, workflow_mode, workflow_template,
             github_repo, deadline, color, github_sync_enabled, github_labels_initialized, github_default_branch, created_at, updated_at
      FROM projects
      WHERE id = ? AND workspace_id = ?
    `).get(projectId, workspaceId)

    return NextResponse.json({ project })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'PATCH /api/projects/[id] error')
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
      route: '/api/projects/[id]',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })
    const { id } = await params
    const projectId = toProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    const projectScope = db.prepare(`
      SELECT p.id
      FROM projects p
      JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.id = ? AND p.workspace_id = ? AND w.tenant_id = ?
      LIMIT 1
    `).get(projectId, workspaceId, tenantId)
    if (!projectScope) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const current = db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`).get(projectId, workspaceId) as any
    if (!current) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (current.slug === 'general') {
      return NextResponse.json({ error: 'Default project cannot be deleted' }, { status: 400 })
    }

    const mode = new URL(request.url).searchParams.get('mode') || 'archive'
    if (mode !== 'delete') {
      db.prepare(`UPDATE projects SET status = 'archived', updated_at = unixepoch() WHERE id = ? AND workspace_id = ?`).run(projectId, workspaceId)
      return NextResponse.json({ success: true, mode: 'archive' })
    }

    const fallback = db.prepare(`
      SELECT id FROM projects
      WHERE workspace_id = ? AND slug = 'general'
      LIMIT 1
    `).get(workspaceId) as { id: number } | undefined
    if (!fallback) return NextResponse.json({ error: 'Default project missing' }, { status: 500 })

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE tasks
        SET project_id = ?
        WHERE workspace_id = ? AND project_id = ?
      `).run(fallback.id, workspaceId, projectId)

      db.prepare(`DELETE FROM projects WHERE id = ? AND workspace_id = ?`).run(projectId, workspaceId)
    })
    tx()

    return NextResponse.json({ success: true, mode: 'delete' })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'DELETE /api/projects/[id] error')
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }
}
