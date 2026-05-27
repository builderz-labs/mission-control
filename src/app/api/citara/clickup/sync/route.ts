import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

const CLICKUP_API = 'https://api.clickup.com/api/v2'

function getClickUpConfig() {
  return {
    token: process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_TOKEN || '',
    listId: process.env.CLICKUP_LIST_ID || process.env.CITARA_CLICKUP_LIST_ID || '',
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const cfg = getClickUpConfig()
  return NextResponse.json({
    ok: true,
    configured: Boolean(cfg.token && cfg.listId),
    has_token: Boolean(cfg.token),
    list_id: cfg.listId || null,
    mode: cfg.token && cfg.listId ? 'ready' : 'needs_env',
    required_env: ['CLICKUP_API_TOKEN', 'CLICKUP_LIST_ID'],
  })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const cfg = getClickUpConfig()
    if (!cfg.token || !cfg.listId) {
      return NextResponse.json({
        error: 'ClickUp não configurado',
        required_env: ['CLICKUP_API_TOKEN', 'CLICKUP_LIST_ID'],
      }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const taskId = Number(body.task_id)
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return NextResponse.json({ error: 'task_id inválido' }, { status: 400 })
    }

    const workspaceId = auth.user.workspace_id ?? 1
    const db = getDatabase()
    const task = db.prepare(`
      SELECT t.*, p.name AS project_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ?
    `).get(taskId, workspaceId) as any
    if (!task) return NextResponse.json({ error: 'Task não encontrada' }, { status: 404 })

    const metadata = task.metadata ? JSON.parse(task.metadata) : {}
    const client = metadata.client || metadata.cliente || task.project_name || 'Cítara / Interno'
    const description = [
      task.description || '',
      '',
      `Origem: Mission Control`,
      `Cliente: ${client}`,
      `Agente: ${task.assigned_to || 'não definido'}`,
      `Status MC: ${task.status}`,
      task.resolution ? `\nResultado:\n${task.resolution}` : '',
      task.error_message ? `\nErro:\n${task.error_message}` : '',
    ].filter(Boolean).join('\n')

    const res = await fetch(`${CLICKUP_API}/list/${cfg.listId}/task`, {
      method: 'POST',
      headers: {
        Authorization: cfg.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: task.title,
        description,
        tags: ['mission-control', 'citara', ...(task.tags ? JSON.parse(task.tags) : [])].slice(0, 20),
        priority: task.priority === 'critical' || task.priority === 'urgent' ? 1 : task.priority === 'high' ? 2 : task.priority === 'medium' ? 3 : 4,
      }),
    })

    const text = await res.text()
    let payload: any = text
    try { payload = JSON.parse(text) } catch {}

    if (!res.ok) {
      return NextResponse.json({ error: 'ClickUp API falhou', status: res.status, payload }, { status: 502 })
    }

    const clickupId = payload?.id
    const now = Math.floor(Date.now() / 1000)
    const nextMetadata = { ...metadata, clickup_task_id: clickupId, clickup_synced_at: now }
    db.prepare('UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
      .run(JSON.stringify(nextMetadata), now, taskId, workspaceId)

    return NextResponse.json({ ok: true, clickup_task_id: clickupId, clickup_url: payload?.url || null, payload })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/citara/clickup/sync error')
    return NextResponse.json({ error: 'Falha no sync ClickUp' }, { status: 500 })
  }
}
