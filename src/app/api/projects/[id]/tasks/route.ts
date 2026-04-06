import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import {
  ensureTenantWorkspaceAccess,
  ForbiddenError
} from '@/lib/workspaces'

function formatTicketRef(prefix?: string | null, num?: number | null): string | undefined {
  if (!prefix || typeof num !== 'number' || !Number.isFinite(num) || num <= 0) return undefined
  return `${prefix}-${String(num).padStart(3, '0')}`
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
      route: '/api/projects/[id]/tasks',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })
    const { id } = await params
    const projectId = Number.parseInt(id, 10)
    if (!Number.isFinite(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })
    }
    const projectScope = db.prepare(`
      SELECT p.id
      FROM projects p
      JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.id = ? AND p.workspace_id = ? AND w.tenant_id = ?
      LIMIT 1
    `).get(projectId, workspaceId, tenantId)
    if (!projectScope) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const project = db.prepare(`
      SELECT id, workspace_id, name, slug, description, ticket_prefix, ticket_counter, status, created_at, updated_at
      FROM projects
      WHERE id = ? AND workspace_id = ?
    `).get(projectId, workspaceId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const tasks = db.prepare(`
      SELECT t.*, p.name as project_name, p.ticket_prefix as project_prefix
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.workspace_id = ? AND t.project_id = ?
      ORDER BY t.created_at DESC
    `).all(workspaceId, projectId) as Array<{ tags: string | null; metadata: string | null; project_prefix: string | null; project_ticket_no: number | null; [key: string]: unknown }>

    return NextResponse.json({
      project,
      tasks: tasks.map((task) => ({
        ...task,
        tags: task.tags ? JSON.parse(task.tags) : [],
        metadata: task.metadata ? JSON.parse(task.metadata) : {},
        ticket_ref: formatTicketRef(task.project_prefix, task.project_ticket_no),
      }))
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/tasks error')
    return NextResponse.json({ error: 'Failed to fetch project tasks' }, { status: 500 })
  }
}
