import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { parseTaskMetadata, hasOwnerQueueEvidence, serializeTaskMetadata, TaskMetadataShape } from '@/lib/task-harness'
import { syncTaskOutbound } from '@/lib/github-sync-engine'

interface OwnerQueueAuditRow {
  id: number
  title: string
  status: 'needs_owner' | 'awaiting_owner'
  assigned_to: string | null
  created_at: number
  updated_at: number
  metadata: string | null
}

interface OwnerQueueAuditItem {
  id: number
  title: string
  status: 'needs_owner' | 'awaiting_owner'
  assigned_to: string | null
  owner_required_reason?: string
  owner_queue_kind?: unknown
}

function normalizeTaskIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []

  const ids = raw
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0)

  return [...new Set(ids)]
}

function stripOwnerQueueHints(metadata: TaskMetadataShape): TaskMetadataShape {
  const next = { ...metadata } as TaskMetadataShape

  delete next.owner_candidate
  delete next.owner_required_reason
  delete next.owner_queue_kind
  delete next.owner_queue_entered_at
  delete next.owner_queue_expired_at
  delete next.owner_queue_expiry_reason

  if (next.harness && typeof next.harness === 'object') {
    const harness = { ...(next.harness as Record<string, unknown>) }
    if ((harness.step as string | undefined) === 'needs_owner') {
      delete harness.step
    }
    next.harness = harness
    if (Object.keys(harness).length === 0) {
      delete next.harness
    }
  }

  return next
}

function buildItemFromRow(row: OwnerQueueAuditRow): OwnerQueueAuditItem {
  const metadata = parseTaskMetadata(row.metadata)
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    assigned_to: row.assigned_to,
    owner_required_reason: typeof metadata.owner_required_reason === 'string'
      ? metadata.owner_required_reason
      : undefined,
    owner_queue_kind: metadata.owner_queue_kind,
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const searchParams = request.nextUrl.searchParams
    const rawLimit = Number.parseInt(searchParams.get('limit') || '200', 10)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 200
    const projectIdRaw = Number.parseInt(searchParams.get('project_id') || '', 10)
    const projectId = Number.isFinite(projectIdRaw) && projectIdRaw > 0 ? projectIdRaw : null

    const query = `
        SELECT id, title, status, assigned_to, created_at, updated_at, metadata
        FROM tasks
        WHERE workspace_id = ?
          AND status IN ('needs_owner', 'awaiting_owner')
          ${projectId ? 'AND project_id = ?' : ''}
        ORDER BY updated_at DESC
        LIMIT ?
      `
    const params = [workspaceId, ...(projectId ? [projectId] : []), limit] as any[]

    const rows = db.prepare(query).all(...params) as OwnerQueueAuditRow[]

    const items = rows
      .map((row) => ({ row, metadata: parseTaskMetadata(row.metadata) }))
      .filter(({ metadata }) => !hasOwnerQueueEvidence(metadata))
      .map(({ row }) => buildItemFromRow(row))

    return NextResponse.json({
      items,
      total: items.length,
      checked: rows.length,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/owner-queue-audit error')
    return NextResponse.json({ error: 'Failed to audit owner queue tasks' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json().catch(() => ({} as { taskIds?: unknown; dryRun?: boolean }))
    const taskIds = normalizeTaskIds(body?.taskIds)
    const dryRun = body?.dryRun === true

    if (taskIds.length === 0) {
      return NextResponse.json({ error: 'taskIds is required' }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const actor = auth.user.username || auth.user.display_name || 'system'
    const placeholders = taskIds.map(() => '?').join(',')
    const now = Math.floor(Date.now() / 1000)

    const rows = db
      .prepare(`
        SELECT id, title, status, assigned_to, metadata, created_at, updated_at
        FROM tasks
        WHERE workspace_id = ?
          AND id IN (${placeholders})
          AND status IN ('needs_owner', 'awaiting_owner')
      `)
      .all(workspaceId, ...taskIds) as OwnerQueueAuditRow[]

    const rowById = new Map<number, OwnerQueueAuditRow>(rows.map((row) => [row.id, row]))

    const checked = taskIds.filter((id) => rowById.has(id))
    const missing = taskIds.filter((id) => !rowById.has(id))

    const validTargetRows = rows.filter((row) => {
      const metadata = parseTaskMetadata(row.metadata)
      return !hasOwnerQueueEvidence(metadata)
    })

    const skipped = rows
      .filter((row) => {
        const metadata = parseTaskMetadata(row.metadata)
        return hasOwnerQueueEvidence(metadata)
      })
      .map((row) => row.id)

    if (!dryRun && validTargetRows.length > 0) {
      const updateStmt = db.prepare(`
        UPDATE tasks
        SET status = ?, metadata = ?, error_message = NULL, dispatch_attempts = 0, updated_at = ?
        WHERE id = ? AND workspace_id = ?
      `)

      const commentStmt = db.prepare(`
        INSERT INTO comments (task_id, author, content, created_at, workspace_id)
        VALUES (?, ?, ?, ?, ?)
      `)

      const transaction = db.transaction((tasksToFix: OwnerQueueAuditRow[]) => {
        for (const row of tasksToFix) {
          const oldMetadata = parseTaskMetadata(row.metadata)
          const nextMetadata = stripOwnerQueueHints(oldMetadata)
          const nextStatus = row.assigned_to ? 'assigned' : 'inbox'

          updateStmt.run(nextStatus, serializeTaskMetadata(nextMetadata), now, row.id, workspaceId)

          commentStmt.run(
            row.id,
            actor,
            `Owner queue cleanup: missing owner evidence. moved ${row.status} -> ${nextStatus}.`,
            now,
            workspaceId,
          )

          db_helpers.logActivity(
            'task_updated',
            'task',
            row.id,
            actor,
            `Task moved from ${row.status} to ${nextStatus} (owner queue cleanup)`,
            {
              oldValues: { status: row.status, metadata: oldMetadata },
              newValues: { status: nextStatus, metadata: nextMetadata },
            },
            workspaceId,
          )

          eventBus.broadcast('task.status_changed', {
            id: row.id,
            status: nextStatus,
            previous_status: row.status,
            reason: 'owner_queue_audit_cleanup',
          })

          const repairedTask = db
            .prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?')
            .get(row.id, workspaceId)
          if (repairedTask) {
            syncTaskOutbound(repairedTask as any, workspaceId)
          }
        }
      })

      transaction(validTargetRows)
    }

    return NextResponse.json({
      requested: taskIds.length,
      checked: checked.length,
      fixed: validTargetRows.length,
      skipped,
      missing,
      dryRun,
      items: validTargetRows.map(buildItemFromRow),
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/owner-queue-audit error')
    return NextResponse.json({ error: 'Failed to clean owner queue tasks' }, { status: 500 })
  }
}
