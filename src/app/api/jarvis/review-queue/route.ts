import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { parseTaskCallbackPayload } from '@/lib/callback-payload'
import { logger } from '@/lib/logger'

/**
 * GET /api/jarvis/review-queue
 *
 * Returns tasks sitting in 'review' or 'quality_review' status with their
 * callback payloads fully parsed and normalised. This is the single data
 * source the review queue UI should poll — it does not return raw JSON blobs.
 *
 * Query params:
 *   status   - comma-separated list, default "review,quality_review"
 *   limit    - integer 1..100, default 20
 *   offset   - integer, default 0
 *
 * Each task in the response includes a `payload` field shaped as CallbackPayload:
 * {
 *   answer: string | null,          // agent's main response text
 *   clickupTaskUrl: string | null,  // ClickUp link if present
 *   files: Array<{                  // downloadable files
 *     name: string,
 *     url: string | null,
 *     size: number | null,
 *     mime: string | null
 *   }>,
 *   extra: Record<string, unknown>, // any other fields the agent returned
 *   isStructured: boolean           // true if agent returned JSON payload
 * }
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)

    const statusParam = searchParams.get('status') ?? 'review,quality_review'
    const allowedStatuses = ['review', 'quality_review', 'in_progress', 'done']
    const statuses = statusParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => allowedStatuses.includes(s))

    if (statuses.length === 0) {
      return NextResponse.json({ error: 'No valid status values provided' }, { status: 400 })
    }

    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)
    const offset = parseInt(searchParams.get('offset') ?? '0', 10)

    const placeholders = statuses.map(() => '?').join(', ')

    const rows = db.prepare(`
      SELECT
        t.id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.assigned_to,
        t.created_by,
        t.created_at,
        t.updated_at,
        t.outcome,
        t.resolution,
        t.error_message,
        t.tags,
        t.metadata,
        p.name   AS project_name,
        p.ticket_prefix AS project_prefix,
        t.project_ticket_no
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.workspace_id = ? AND t.status IN (${placeholders})
      ORDER BY
        CASE t.priority
          WHEN 'critical' THEN 0
          WHEN 'high'     THEN 1
          WHEN 'medium'   THEN 2
          ELSE 3
        END ASC,
        t.updated_at DESC
      LIMIT ? OFFSET ?
    `).all(workspaceId, ...statuses, limit, offset) as Array<{
      id: number
      title: string
      description: string | null
      status: string
      priority: string
      assigned_to: string | null
      created_by: string
      created_at: number
      updated_at: number
      outcome: string | null
      resolution: string | null
      error_message: string | null
      tags: string | null
      metadata: string | null
      project_name: string | null
      project_prefix: string | null
      project_ticket_no: number | null
    }>

    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM tasks
      WHERE workspace_id = ? AND status IN (${placeholders})
    `).get(workspaceId, ...statuses) as { total: number }

    const items = rows.map((row) => {
      let meta: Record<string, unknown> = {}
      try {
        meta = row.metadata ? JSON.parse(row.metadata) : {}
      } catch {
        // ignore malformed metadata
      }

      let tags: string[] = []
      try {
        tags = row.tags ? JSON.parse(row.tags) : []
      } catch {
        // ignore
      }

      const ticketRef =
        row.project_prefix && row.project_ticket_no
          ? `${row.project_prefix}-${String(row.project_ticket_no).padStart(3, '0')}`
          : null

      const payload = parseTaskCallbackPayload(row.resolution, meta)

      return {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        assigned_to: row.assigned_to,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        outcome: row.outcome,
        error_message: row.error_message,
        tags,
        ticket_ref: ticketRef,
        project_name: row.project_name,
        // Parsed, structured payload — this replaces the raw resolution dump
        payload,
      }
    })

    return NextResponse.json({
      items,
      total: countRow.total,
      page: Math.floor(offset / limit) + 1,
      limit,
    })
  } catch (err: any) {
    logger.error({ err }, 'GET /api/jarvis/review-queue error')
    return NextResponse.json({ error: 'Failed to fetch review queue' }, { status: 500 })
  }
}
