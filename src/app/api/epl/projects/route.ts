/**
 * GET /api/epl/projects
 *
 * 6-column Kanban data backing the EPL Projects panel.
 * Phase 2a — now reads REAL data from MC's tasks table (post-Phase-1 schema).
 * Mock columns kept as fallback when no tasks exist (fresh install / dev).
 *
 * ⚠️ ARCHITECTURE DECISION 28 May 2026:
 *   Asana is ARCHIVE-ONLY. This panel reads ACTIVE work from MC's own
 *   tasks DB. See memory/decision_asana_archive_only_28may.md +
 *   memory/finding_mc_tasks_db_gap_analysis_08jun.md.
 *
 * Column mapping (9 statuses → 6 columns):
 *   inbox        ← backlog + inbox        (not started, no owner)
 *   up_next      ← assigned               (queued, owner set)
 *   in_progress  ← in_progress
 *   waiting      ← awaiting_owner         (blocked on a person)
 *   review       ← review + quality_review
 *   done_this_week ← done where completed_at >= now - 7d
 *
 * Failed tasks shown via the future Failed filter view, not on the main board.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

type TaskRow = {
  id: number
  title: string
  status: string
  priority: string
  assigned_to: string | null
  created_at: number
  completed_at: number | null
  tags: string | null
  project_id: number | null
  project_prefix: string | null
  project_ticket_no: number | null
  parent_task_id: number | null
}

interface Card {
  id: string
  title: string
  owner: string
  tags: string[]
  age: string
}

interface Column {
  id: string
  label: string
  cards: Card[]
}

const COLUMN_DEFS: Array<{ id: string; label: string }> = [
  { id: 'inbox',          label: 'Inbox' },
  { id: 'up_next',        label: 'Up next' },
  { id: 'in_progress',    label: 'In progress' },
  { id: 'waiting',        label: 'Waiting' },
  { id: 'review',         label: 'Review' },
  { id: 'done_this_week', label: 'Done (this week)' },
]

function statusToColumn(status: string, completedAt: number | null): string | null {
  switch (status) {
    case 'backlog':
    case 'inbox':
      return 'inbox'
    case 'assigned':
      return 'up_next'
    case 'in_progress':
      return 'in_progress'
    case 'awaiting_owner':
      return 'waiting'
    case 'review':
    case 'quality_review':
      return 'review'
    case 'done': {
      const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600
      return completedAt && completedAt >= weekAgo ? 'done_this_week' : null
    }
    case 'failed':
      return null
    default:
      return null
  }
}

function formatTicketRef(prefix: string | null, num: number | null): string | undefined {
  if (!prefix || !num) return undefined
  return `${prefix}-${String(num).padStart(3, '0')}`
}

function ageDays(createdAt: number): string {
  const seconds = Math.floor(Date.now() / 1000) - createdAt
  const days = Math.max(0, Math.floor(seconds / 86400))
  return `${days}d`
}

function mapRowToCard(row: TaskRow): Card {
  const ticketRef = formatTicketRef(row.project_prefix, row.project_ticket_no)
  const titlePrefix = ticketRef ? `[${ticketRef}] ` : ''
  return {
    id: String(row.id),
    title: `${titlePrefix}${row.title}`,
    owner: row.assigned_to || 'unassigned',
    tags: row.tags ? safeParseTags(row.tags) : [],
    age: ageDays(row.created_at),
  }
}

function safeParseTags(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function buildColumnsFromTasks(rows: TaskRow[]): Column[] {
  const columns: Column[] = COLUMN_DEFS.map(c => ({ id: c.id, label: c.label, cards: [] }))
  const byId = new Map(columns.map(c => [c.id, c]))
  for (const row of rows) {
    // Root tasks only on the board; subtasks shown in detail drawer (Phase 2c).
    if (row.parent_task_id) continue
    const colId = statusToColumn(row.status, row.completed_at)
    if (!colId) continue
    const col = byId.get(colId)
    if (col) col.cards.push(mapRowToCard(row))
  }
  return columns
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const part = new URL(request.url).searchParams.get('part')

    const rows = db.prepare(`
      SELECT t.id, t.title, t.status, t.priority, t.assigned_to, t.created_at, t.completed_at,
             t.tags, t.project_id, t.parent_task_id,
             p.ticket_prefix as project_prefix, t.project_ticket_no
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.workspace_id = ?
      ORDER BY t.created_at DESC
    `).all(workspaceId) as TaskRow[]

    const columns = buildColumnsFromTasks(rows)

    if (part === 'summary') {
      return NextResponse.json({
        ok: true,
        counts: Object.fromEntries(columns.map(c => [c.id, c.cards.length])),
        total: columns.reduce((s, c) => s + c.cards.length, 0),
      })
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      columns,
      source: 'mc-tasks-db',
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/epl/projects error')
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
  }
}
