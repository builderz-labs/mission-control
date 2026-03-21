import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import { normalizeProjectWorkflowMode, normalizeProjectWorkflowTemplate } from '@/lib/edict-workflow'

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function normalizePrefix(input: string): string {
  const normalized = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return normalized.slice(0, 12)
}

export async function GET(request: NextRequest) {
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
      route: '/api/projects',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })
    const includeArchived = new URL(request.url).searchParams.get('includeArchived') === '1'

    const rows = db.prepare(`
      SELECT p.id, p.workspace_id, p.name, p.slug, p.description, p.ticket_prefix, p.ticket_counter, p.status,
             p.workflow_mode, p.workflow_template,
             p.github_repo, p.deadline, p.color, p.github_sync_enabled, p.github_labels_initialized, p.github_default_branch, p.created_at, p.updated_at,
             (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
             (SELECT GROUP_CONCAT(paa.agent_name) FROM project_agent_assignments paa WHERE paa.project_id = p.id) as assigned_agents_csv
      FROM projects p
      WHERE p.workspace_id = ?
        ${includeArchived ? '' : "AND p.status = 'active'"}
      ORDER BY p.name COLLATE NOCASE ASC
    `).all(workspaceId) as Array<Record<string, unknown>>

    const projects = rows.map(row => ({
      ...row,
      assigned_agents: row.assigned_agents_csv ? String(row.assigned_agents_csv).split(',') : [],
      assigned_agents_csv: undefined,
    }))

    return NextResponse.json({ projects })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'GET /api/projects error')
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
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
      route: '/api/projects',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })
    const body = await request.json()

    const name = String(body?.name || '').trim()
    const description = typeof body?.description === 'string' ? body.description.trim() : ''
    const prefixInput = String(body?.ticket_prefix || body?.ticketPrefix || '').trim()
    const slugInput = String(body?.slug || '').trim()
    const githubRepo = typeof body?.github_repo === 'string' ? body.github_repo.trim() || null : null
    const deadline = typeof body?.deadline === 'number' ? body.deadline : null
    const color = typeof body?.color === 'string' ? body.color.trim() || null : null
    const workflowMode = normalizeProjectWorkflowMode(body?.workflow_mode ?? body?.workflow_template)
    const workflowTemplate = normalizeProjectWorkflowTemplate(body?.workflow_template ?? body?.workflow_mode)

    if (!name) return NextResponse.json({ error: 'Project name is required' }, { status: 400 })

    const slug = slugInput ? slugify(slugInput) : slugify(name)
    const ticketPrefix = normalizePrefix(prefixInput || name.slice(0, 5))
    if (!slug) return NextResponse.json({ error: 'Invalid project slug' }, { status: 400 })
    if (!ticketPrefix) return NextResponse.json({ error: 'Invalid ticket prefix' }, { status: 400 })

    const exists = db.prepare(`
      SELECT id FROM projects
      WHERE workspace_id = ? AND (slug = ? OR ticket_prefix = ?)
      LIMIT 1
    `).get(workspaceId, slug, ticketPrefix) as { id: number } | undefined
    if (exists) {
      return NextResponse.json({ error: 'Project slug or ticket prefix already exists' }, { status: 409 })
    }

    const result = db.prepare(`
      INSERT INTO projects (workspace_id, name, slug, description, ticket_prefix, workflow_mode, workflow_template, github_repo, deadline, color, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())
    `).run(workspaceId, name, slug, description || null, ticketPrefix, workflowMode, workflowTemplate, githubRepo, deadline, color)

    const project = db.prepare(`
      SELECT id, workspace_id, name, slug, description, ticket_prefix, ticket_counter, status, workflow_mode, workflow_template,
             github_repo, deadline, color, github_sync_enabled, github_labels_initialized, github_default_branch, created_at, updated_at
      FROM projects
      WHERE id = ?
    `).get(Number(result.lastInsertRowid))

    return NextResponse.json({ project }, { status: 201 })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/projects error')
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }
}
