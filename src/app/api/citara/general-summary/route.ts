import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

type TaskRow = {
  id: number
  title: string
  description?: string | null
  status: string
  priority: string
  assigned_to?: string | null
  created_at: number
  updated_at: number
  completed_at?: number | null
  tags?: string | null
  metadata?: string | null
  outcome?: string | null
  error_message?: string | null
  resolution?: string | null
  project_name?: string | null
  project_slug?: string | null
}

const SPECIALIST_TOPICS = [
  'Comando Nexus',
  'Inteligência',
  'Laboratório',
  'Crescimento',
  'Orgânico',
  'Web',
  'Busca',
  'Comercial',
  'Operações',
]

function safeJson(value: string | null | undefined): any {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

function parseTags(value: string | null | undefined): string[] {
  const parsed = safeJson(value)
  if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string')
  if (typeof value === 'string' && value.trim()) return value.split(',').map((x) => x.trim()).filter(Boolean)
  return []
}

function inferClient(task: TaskRow): string {
  const metadata = safeJson(task.metadata) || {}
  if (typeof metadata.client === 'string' && metadata.client.trim()) return metadata.client.trim()
  if (typeof metadata.cliente === 'string' && metadata.cliente.trim()) return metadata.cliente.trim()
  if (task.project_name) return task.project_name

  const tags = parseTags(task.tags)
  const clientTag = tags.find((tag) => tag.startsWith('cliente:') || tag.startsWith('client:'))
  if (clientTag) return clientTag.split(':').slice(1).join(':').trim() || 'Sem cliente'

  return 'Cítara / Interno'
}

function inferTopic(task: TaskRow): string {
  const metadata = safeJson(task.metadata) || {}
  if (typeof metadata.topic === 'string' && metadata.topic.trim()) return metadata.topic.trim()
  const assigned = task.assigned_to || ''
  const match = SPECIALIST_TOPICS.find((topic) => assigned.toLowerCase().includes(topic.toLowerCase()))
  return match || 'Geral'
}

function taskRisk(task: TaskRow): 'blocked' | 'review' | 'running' | 'queued' | 'ok' {
  if (task.status === 'failed') return 'blocked'
  if (task.status === 'quality_review' || task.status === 'review') return 'review'
  if (task.status === 'in_progress') return 'running'
  if (task.status === 'awaiting_owner' || task.status === 'assigned' || task.status === 'inbox') return 'queued'
  return 'ok'
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT
        t.*,
        p.name AS project_name,
        p.slug AS project_slug
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.workspace_id = ?
      ORDER BY t.updated_at DESC
      LIMIT 500
    `).all(workspaceId) as TaskRow[]

    const statusCounts: Record<string, number> = {}
    const topicCounts: Record<string, number> = {}
    const clients = new Map<string, any>()
    const needsApproval: any[] = []
    const blocked: any[] = []
    const recentDone: any[] = []

    for (const task of rows) {
      statusCounts[task.status] = (statusCounts[task.status] || 0) + 1
      const topic = inferTopic(task)
      const client = inferClient(task)
      const risk = taskRisk(task)
      topicCounts[topic] = (topicCounts[topic] || 0) + 1

      if (!clients.has(client)) {
        clients.set(client, {
          name: client,
          total: 0,
          by_status: {},
          by_topic: {},
          open: 0,
          review: 0,
          failed: 0,
          done: 0,
          last_activity_at: 0,
          top_tasks: [],
        })
      }
      const c = clients.get(client)
      c.total += 1
      c.by_status[task.status] = (c.by_status[task.status] || 0) + 1
      c.by_topic[topic] = (c.by_topic[topic] || 0) + 1
      c.last_activity_at = Math.max(c.last_activity_at, task.updated_at || task.created_at || 0)
      if (task.status === 'done') c.done += 1
      else c.open += 1
      if (task.status === 'quality_review' || task.status === 'review') c.review += 1
      if (task.status === 'failed') c.failed += 1
      if (c.top_tasks.length < 5 && task.status !== 'done') {
        c.top_tasks.push({ id: task.id, title: task.title, status: task.status, priority: task.priority, assigned_to: task.assigned_to, risk })
      }

      const compact = {
        id: task.id,
        title: task.title,
        client,
        topic,
        status: task.status,
        priority: task.priority,
        assigned_to: task.assigned_to,
        updated_at: task.updated_at,
        resolution: task.resolution,
        error_message: task.error_message,
      }
      if (risk === 'review') needsApproval.push(compact)
      if (risk === 'blocked') blocked.push(compact)
      if (task.status === 'done' && recentDone.length < 12) recentDone.push(compact)
    }

    const openTotal = rows.filter((t) => !['done'].includes(t.status)).length
    const summary = {
      generated_at: new Date().toISOString(),
      workspace_id: workspaceId,
      health: blocked.length > 0 ? 'attention' : needsApproval.length > 0 ? 'review' : openTotal > 0 ? 'active' : 'clear',
      headline: `${openTotal} abertas · ${needsApproval.length} em aprovação · ${blocked.length} bloqueadas · ${statusCounts.done || 0} concluídas`,
      status_counts: statusCounts,
      topic_counts: topicCounts,
      clients: Array.from(clients.values()).sort((a, b) => b.last_activity_at - a.last_activity_at),
      general_report: {
        nexus_command: {
          focus: needsApproval.length ? 'Aprovar entregas em revisão e destravar fila.' : 'Fila limpa; criar próximas tasks por cliente.',
          needs_approval: needsApproval.slice(0, 20),
          blocked: blocked.slice(0, 20),
        },
        specialists: SPECIALIST_TOPICS.map((topic) => ({
          topic,
          total: topicCounts[topic] || 0,
          open: rows.filter((t) => inferTopic(t) === topic && t.status !== 'done').length,
          review: rows.filter((t) => inferTopic(t) === topic && (t.status === 'quality_review' || t.status === 'review')).length,
          failed: rows.filter((t) => inferTopic(t) === topic && t.status === 'failed').length,
        })),
        recent_done: recentDone,
      },
      next_actions: [
        'Aprovar/reprovar tasks em quality_review usando botões claros no painel.',
        'Enviar tasks reais por cliente com metadata.client/cliente para alimentar dashboard por cliente.',
        'Configurar CLICKUP_API_TOKEN e CLICKUP_LIST_ID para ativar sync direto com ClickUp.',
      ],
    }

    return NextResponse.json(summary)
  } catch (error) {
    logger.error({ err: error }, 'GET /api/citara/general-summary error')
    return NextResponse.json({ error: 'Failed to build Cítara general summary' }, { status: 500 })
  }
}
