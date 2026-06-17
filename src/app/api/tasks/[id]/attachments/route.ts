import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody, createAttachmentSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

type Attachment = {
  id: number
  task_id: number
  workspace_id: number
  type: string
  url: string
  label: string | null
  mime_type: string | null
  size_bytes: number | null
  added_by: string
  added_at: number
}

/**
 * GET /api/tasks/[id]/attachments — list attachments for a task.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const taskId = parseInt(resolvedParams.id, 10)
    const workspaceId = auth.user.workspace_id ?? 1

    if (Number.isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const task = db
      .prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?')
      .get(taskId, workspaceId)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const attachments = db.prepare(`
      SELECT id, task_id, workspace_id, type, url, label, mime_type, size_bytes, added_by, added_at
      FROM task_attachments
      WHERE task_id = ? AND workspace_id = ?
      ORDER BY added_at ASC
    `).all(taskId, workspaceId) as Attachment[]

    return NextResponse.json({ attachments })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/[id]/attachments error')
    return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: 500 })
  }
}

/**
 * POST /api/tasks/[id]/attachments — add an attachment to a task.
 *
 * Body: { type, url, label?, mime_type?, size_bytes? }
 * The `added_by` is the authenticated actor; clients don't pass it.
 */
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
    const resolvedParams = await params
    const taskId = parseInt(resolvedParams.id, 10)
    const workspaceId = auth.user.workspace_id ?? 1

    if (Number.isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const task = db
      .prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?')
      .get(taskId, workspaceId)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const validated = await validateBody(request, createAttachmentSchema)
    if ('error' in validated) return validated.error
    const { type, url, label, mime_type, size_bytes } = validated.data

    const actor = auth.user.display_name || auth.user.username || 'system'

    const result = db.prepare(`
      INSERT INTO task_attachments (task_id, workspace_id, type, url, label, mime_type, size_bytes, added_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, workspaceId, type, url, label ?? null, mime_type ?? null, size_bytes ?? null, actor)

    const attachment = db.prepare(`
      SELECT id, task_id, workspace_id, type, url, label, mime_type, size_bytes, added_by, added_at
      FROM task_attachments WHERE id = ?
    `).get(Number(result.lastInsertRowid)) as Attachment

    return NextResponse.json({ attachment }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/attachments error')
    return NextResponse.json({ error: 'Failed to add attachment' }, { status: 500 })
  }
}

/**
 * DELETE /api/tasks/[id]/attachments?attachmentId=N — remove an attachment.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const taskId = parseInt(resolvedParams.id, 10)
    const workspaceId = auth.user.workspace_id ?? 1
    const attachmentIdParam = new URL(request.url).searchParams.get('attachmentId')
    const attachmentId = attachmentIdParam ? parseInt(attachmentIdParam, 10) : NaN

    if (Number.isNaN(taskId) || Number.isNaN(attachmentId)) {
      return NextResponse.json({ error: 'Invalid task or attachment ID' }, { status: 400 })
    }

    const result = db.prepare(`
      DELETE FROM task_attachments
      WHERE id = ? AND task_id = ? AND workspace_id = ?
    `).run(attachmentId, taskId, workspaceId)

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/tasks/[id]/attachments error')
    return NextResponse.json({ error: 'Failed to delete attachment' }, { status: 500 })
  }
}
