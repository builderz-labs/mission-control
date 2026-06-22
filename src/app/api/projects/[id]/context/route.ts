import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { ensureTenantWorkspaceAccess, ForbiddenError } from '@/lib/workspaces'
import {
  findProjectInScope,
  parseJsonColumn,
  parseProjectId,
  trimmedString,
} from '@/lib/creative-cms'

const ENTRY_TYPES = [
  'brief',
  'research',
  'decision',
  'meeting',
  'asset_note',
  'agent_log',
  'client_feedback',
  'milestone',
  'brand_note',
] as const
type EntryType = (typeof ENTRY_TYPES)[number]

interface ContextRow {
  id: number
  project_id: number
  workspace_id: number
  entry_type: string
  title: string
  content: string
  source: string | null
  metadata: string
  created_by: string | null
  created_at: number
  updated_at: number
}

function serialize(row: ContextRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    workspace_id: row.workspace_id,
    entry_type: row.entry_type,
    title: row.title,
    content: row.content,
    source: row.source,
    metadata: parseJsonColumn<Record<string, unknown>>(row.metadata, {}),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function isEntryType(value: unknown): value is EntryType {
  return typeof value === 'string' && (ENTRY_TYPES as readonly string[]).includes(value)
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
      route: '/api/projects/[id]/context',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = parseProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

    const project = findProjectInScope(db, projectId, workspaceId, tenantId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const url = new URL(request.url)
    const entryTypeParam = url.searchParams.get('entry_type')
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(
      200,
      Math.max(1, Number.parseInt(url.searchParams.get('pageSize') ?? '50', 10) || 50)
    )

    if (entryTypeParam && !isEntryType(entryTypeParam)) {
      return NextResponse.json({ error: `Unknown entry_type: ${entryTypeParam}` }, { status: 400 })
    }

    const whereParts = ['project_id = ?']
    const whereArgs: unknown[] = [projectId]
    if (entryTypeParam) {
      whereParts.push('entry_type = ?')
      whereArgs.push(entryTypeParam)
    }
    const where = whereParts.join(' AND ')

    const rows = db
      .prepare(
        `SELECT * FROM project_context_entries WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...whereArgs, pageSize, (page - 1) * pageSize) as ContextRow[]

    const totalRow = db
      .prepare(`SELECT COUNT(*) as total FROM project_context_entries WHERE ${where}`)
      .get(...whereArgs) as { total: number }

    return NextResponse.json({
      entries: rows.map(serialize),
      page,
      pageSize,
      total: totalRow.total,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'GET /api/projects/[id]/context error')
    return NextResponse.json({ error: 'Failed to fetch context entries' }, { status: 500 })
  }
}

export async function POST(
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
      route: '/api/projects/[id]/context',
      ipAddress: forwardedFor,
      userAgent: request.headers.get('user-agent'),
    })

    const { id } = await params
    const projectId = parseProjectId(id)
    if (Number.isNaN(projectId)) return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 })

    const project = findProjectInScope(db, projectId, workspaceId, tenantId)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 })

    if (!isEntryType(body.entry_type)) {
      return NextResponse.json({ error: 'entry_type must be one of the known context types' }, { status: 400 })
    }
    const title = trimmedString(body.title, 200)
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })

    const content = typeof body.content === 'string' ? body.content.slice(0, 50_000) : ''
    const source = trimmedString(body.source, 200)
    const metadata =
      body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : {}

    const result = db
      .prepare(
        `INSERT INTO project_context_entries
           (project_id, workspace_id, entry_type, title, content, source, metadata, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        project.id,
        workspaceId,
        body.entry_type,
        title,
        content,
        source,
        JSON.stringify(metadata),
        auth.user.username
      )

    const created = db
      .prepare(`SELECT * FROM project_context_entries WHERE id = ?`)
      .get(Number(result.lastInsertRowid)) as ContextRow
    return NextResponse.json({ entry: serialize(created) }, { status: 201 })
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error({ err: error }, 'POST /api/projects/[id]/context error')
    return NextResponse.json({ error: 'Failed to create context entry' }, { status: 500 })
  }
}
