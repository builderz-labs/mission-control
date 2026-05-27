import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase, db_helpers } from '@/lib/db'
import { logger } from '@/lib/logger'

type ApprovalAction = 'approve' | 'request_changes' | 'reject'

function normalizeAction(value: unknown): ApprovalAction | null {
  if (value === 'approve' || value === 'request_changes' || value === 'reject') return value
  return null
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json().catch(() => ({}))
    const taskId = Number(body.task_id)
    const action = normalizeAction(body.action)
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    const workspaceId = auth.user.workspace_id ?? 1
    const actor = auth.user.display_name || auth.user.username || 'operator'

    if (!Number.isInteger(taskId) || taskId <= 0) {
      return NextResponse.json({ error: 'task_id inválido' }, { status: 400 })
    }
    if (!action) {
      return NextResponse.json({ error: 'action deve ser approve, request_changes ou reject' }, { status: 400 })
    }

    const db = getDatabase()
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(taskId, workspaceId) as any
    if (!task) return NextResponse.json({ error: 'Task não encontrada' }, { status: 404 })

    const now = Math.floor(Date.now() / 1000)
    const comment = [
      action === 'approve' ? '✅ Aprovado pelo operador.' : action === 'request_changes' ? '🟡 Ajustes solicitados pelo operador.' : '❌ Reprovado pelo operador.',
      note ? `\n${note}` : '',
    ].join('')

    db.prepare(`
      INSERT INTO comments (task_id, author, content, created_at, parent_id, mentions, workspace_id)
      VALUES (?, ?, ?, ?, NULL, NULL, ?)
    `).run(taskId, actor, comment, now, workspaceId)

    if (action === 'approve') {
      db.prepare(`
        UPDATE tasks
        SET status = 'done', outcome = COALESCE(outcome, 'success'), completed_at = COALESCE(completed_at, ?), updated_at = ?, feedback_notes = ?
        WHERE id = ? AND workspace_id = ?
      `).run(now, now, note || 'Aprovado no painel Mission Control.', taskId, workspaceId)
    } else if (action === 'request_changes') {
      db.prepare(`
        UPDATE tasks
        SET status = 'awaiting_owner', outcome = 'partial', updated_at = ?, feedback_notes = ?
        WHERE id = ? AND workspace_id = ?
      `).run(now, note || 'Ajustes solicitados no painel Mission Control.', taskId, workspaceId)
    } else {
      db.prepare(`
        UPDATE tasks
        SET status = 'failed', outcome = 'failed', updated_at = ?, error_message = ?
        WHERE id = ? AND workspace_id = ?
      `).run(now, note || 'Reprovado no painel Mission Control.', taskId, workspaceId)
    }

    db_helpers.logActivity(
      'task_approval',
      'task',
      taskId,
      actor,
      `Approval action "${action}" on task: ${task.title}`,
      { action, note },
      workspaceId
    )

    const updated = db.prepare('SELECT id, title, status, outcome, updated_at, completed_at, feedback_notes, error_message FROM tasks WHERE id = ? AND workspace_id = ?').get(taskId, workspaceId)
    return NextResponse.json({ ok: true, action, task: updated })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/citara/approval error')
    return NextResponse.json({ error: 'Falha ao aplicar aprovação' }, { status: 500 })
  }
}
