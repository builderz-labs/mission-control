import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { SqlParam } from '@/lib/types/sql'

interface ReplayBookmark {
  id: number
  task_id: number
  trace_id: number
  step_index: number
  label: string | null
  note: string | null
  created_by: string
  workspace_id: number
  created_at: number
}

const createBookmarkSchema = z.object({
  task_id: z.number().int().positive(),
  trace_id: z.number().int().positive(),
  step_index: z.number().int().min(0),
  label: z.string().max(200).optional(),
  note: z.string().max(2000).optional(),
})

/**
 * GET /api/exec-replay/bookmarks
 * List bookmarks for the current workspace. Optional ?task_id= filter.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const limit = readLimiter(request)
  if (limit) return limit

  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1
  const taskIdParam = request.nextUrl.searchParams.get('task_id')

  const db = getDatabase()
  const params: SqlParam[] = [workspaceId]
  let query = `
    SELECT id, task_id, trace_id, step_index, label, note, created_by, workspace_id, created_at
    FROM replay_bookmarks
    WHERE workspace_id = ?
  `

  if (taskIdParam) {
    const taskId = parseInt(taskIdParam, 10)
    if (!Number.isNaN(taskId)) {
      query += ' AND task_id = ?'
      params.push(taskId)
    }
  }

  query += ' ORDER BY created_at DESC'

  const rows = db.prepare(query).all(...params) as ReplayBookmark[]
  return NextResponse.json({ success: true, data: rows })
}

/**
 * POST /api/exec-replay/bookmarks
 * Create a bookmark for a specific trace step (operator only).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limit = mutationLimiter(request)
  if (limit) return limit

  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1
  const createdBy = auth.user.username

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = createBookmarkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Validation failed' }, { status: 400 })
  }

  const { task_id, trace_id, step_index, label, note } = parsed.data
  const db = getDatabase()

  const result = db.prepare(`
    INSERT INTO replay_bookmarks (task_id, trace_id, step_index, label, note, created_by, workspace_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
  `).run(task_id, trace_id, step_index, label ?? null, note ?? null, createdBy, workspaceId)

  const created = db.prepare(`
    SELECT id, task_id, trace_id, step_index, label, note, created_by, workspace_id, created_at
    FROM replay_bookmarks WHERE id = ?
  `).get(result.lastInsertRowid) as ReplayBookmark

  return NextResponse.json({ success: true, data: created }, { status: 201 })
}
