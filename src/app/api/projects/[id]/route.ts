import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

interface ProjectRow {
  id: number
  workspace_id: number
  name: string
  slug: string
  description: string | null
  ticket_prefix: string
  ticket_counter: number
  status: string
  created_at: number
  updated_at: number
}

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
    const { id } = await params
    const projectId = toProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

    const project = db.prepare(`
      SELECT id, workspace_id, name, slug, description, ticket_prefix, ticket_counter, status, created_at, updated_at
      FROM projects
      WHERE id = ? AND workspace_id = ?
    `).get(projectId, workspaceId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    return NextResponse.json({ project })
  } catch (error) {
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
    const { id } = await params
    const projectId = toProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

    const current = db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`).get(projectId, workspaceId) as ProjectRow | undefined
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

    if (updates.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

    updates.push('updated_at = unixepoch()')
    db.prepare(`
      UPDATE projects
      SET ${updates.join(', ')}
      WHERE id = ? AND workspace_id = ?
    `).run(...paramsList, projectId, workspaceId)

    const project = db.prepare(`
      SELECT id, workspace_id, name, slug, description, ticket_prefix, ticket_counter, status, created_at, updated_at
      FROM projects
      WHERE id = ? AND workspace_id = ?
    `).get(projectId, workspaceId)

    return NextResponse.json({ project })
  } catch (error) {
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
    const { id } = await params
    const projectId = toProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

    const current = db.prepare(`SELECT * FROM projects WHERE id = ? AND workspace_id = ?`).get(projectId, workspaceId) as ProjectRow | undefined
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
    logger.error({ err: error }, 'DELETE /api/projects/[id] error')
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }
}
