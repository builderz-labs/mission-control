import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody, createMemorySchema, updateMemorySchema } from '@/lib/validation'

function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&')
}

function mapMemoryRow(row: any) {
  return {
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : [],
  }
}

/**
 * GET /api/memory/records - List memory records with filtering
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const { searchParams } = new URL(request.url)

    const type = searchParams.get('type')
    const agent = searchParams.get('agent')
    const dateRef = searchParams.get('date_ref')
    const search = searchParams.get('search')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')

    let query = 'SELECT * FROM memory_records WHERE workspace_id = ?'
    const params: any[] = [workspaceId]

    if (type) {
      query += ' AND type = ?'
      params.push(type)
    }
    if (agent) {
      query += ' AND agent = ?'
      params.push(agent)
    }
    if (dateRef) {
      query += ' AND date_ref = ?'
      params.push(dateRef)
    }
    if (search) {
      query += " AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')"
      const escaped = escapeLike(search)
      const like = `%${escaped}%`
      params.push(like, like)
    }

    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total')
    const countRow = db.prepare(countQuery).get(...params) as { total: number }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const rows = db.prepare(query).all(...params)
    const records = rows.map(mapMemoryRow)

    return NextResponse.json({
      records,
      total: countRow.total,
      page: Math.floor(offset / limit) + 1,
      limit,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/memory/records error')
    return NextResponse.json({ error: 'Failed to fetch memory records' }, { status: 500 })
  }
}

/**
 * POST /api/memory/records - Create a new memory record
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const validated = await validateBody(request, createMemorySchema)
    if ('error' in validated) return validated.error
    const body = validated.data

    const result = db.prepare(`
      INSERT INTO memory_records (workspace_id, type, title, content, summary, agent, tags, source_file, date_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workspaceId,
      body.type,
      body.title,
      body.content,
      body.summary ?? null,
      body.agent ?? null,
      JSON.stringify(body.tags),
      body.source_file ?? null,
      body.date_ref ?? null,
    )

    const record = db.prepare('SELECT * FROM memory_records WHERE id = ?').get(Number(result.lastInsertRowid))

    return NextResponse.json({ record: mapMemoryRow(record) }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/memory/records error')
    return NextResponse.json({ error: 'Failed to create memory record' }, { status: 500 })
  }
}

/**
 * PATCH /api/memory/records - Update an existing memory record
 */
export async function PATCH(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const { searchParams } = new URL(request.url)
    const id = parseInt(searchParams.get('id') || '', 10)

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Valid id query parameter is required' }, { status: 400 })
    }

    const existing = db.prepare(
      'SELECT id FROM memory_records WHERE id = ? AND workspace_id = ?'
    ).get(id, workspaceId)
    if (!existing) {
      return NextResponse.json({ error: 'Memory record not found' }, { status: 404 })
    }

    const validated = await validateBody(request, updateMemorySchema)
    if ('error' in validated) return validated.error
    const body = validated.data

    const setClauses: string[] = ['updated_at = unixepoch()']
    const values: any[] = []

    if (body.type !== undefined) { setClauses.push('type = ?'); values.push(body.type) }
    if (body.title !== undefined) { setClauses.push('title = ?'); values.push(body.title) }
    if (body.content !== undefined) { setClauses.push('content = ?'); values.push(body.content) }
    if (body.summary !== undefined) { setClauses.push('summary = ?'); values.push(body.summary) }
    if (body.agent !== undefined) { setClauses.push('agent = ?'); values.push(body.agent) }
    if (body.tags !== undefined) { setClauses.push('tags = ?'); values.push(JSON.stringify(body.tags)) }
    if (body.source_file !== undefined) { setClauses.push('source_file = ?'); values.push(body.source_file) }
    if (body.date_ref !== undefined) { setClauses.push('date_ref = ?'); values.push(body.date_ref) }

    values.push(id, workspaceId)

    db.prepare(
      `UPDATE memory_records SET ${setClauses.join(', ')} WHERE id = ? AND workspace_id = ?`
    ).run(...values)

    const record = db.prepare('SELECT * FROM memory_records WHERE id = ?').get(id)

    return NextResponse.json({ record: mapMemoryRow(record) })
  } catch (error) {
    logger.error({ err: error }, 'PATCH /api/memory/records error')
    return NextResponse.json({ error: 'Failed to update memory record' }, { status: 500 })
  }
}
