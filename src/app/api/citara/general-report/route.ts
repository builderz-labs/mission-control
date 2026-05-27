import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

type CountRow = { status: string; count: number }
type AgentRow = { name: string; role: string; status: string; total: number; active: number; review: number; done: number; failed: number }
type TaskRow = { id: number; title: string; status: string; priority: string; assigned_to: string | null; updated_at: number; resolution: string | null; error_message: string | null }

const TOPIC_BY_AGENT: Record<string, string> = {
  'Cítara Comando Nexus': 'Comando Nexus',
  'Cítara Inteligência': 'Inteligência',
  'Cítara Laboratório': 'Laboratório',
  'Cítara Crescimento': 'Crescimento',
  'Cítara Orgânico': 'Orgânico',
  'Cítara Web': 'Web',
  'Cítara Busca': 'Busca',
  'Cítara Comercial': 'Comercial',
  'Cítara Operações': 'Operações',
}

const CANONICAL_CITARA_AGENTS = Object.keys(TOPIC_BY_AGENT)

function parseLimit(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get('limit')
  const n = raw ? Number(raw) : 10
  if (!Number.isFinite(n)) return 10
  return Math.max(1, Math.min(50, Math.floor(n)))
}

function buildExecutiveSummary(counts: Record<string, number>, agents: AgentRow[]): string[] {
  const queue = counts.awaiting_owner || 0
  const running = counts.in_progress || 0
  const review = counts.quality_review || 0
  const failed = counts.failed || 0
  const done = counts.done || 0
  const adapterReady = agents.filter(a => CANONICAL_CITARA_AGENTS.includes(a.name)).length

  const lines = [
    `Agentes Cítara prontos: ${adapterReady}/9`,
    `Fila aguardando Hermes Adapter: ${queue}`,
    `Em execução: ${running}`,
    `Aguardando revisão humana: ${review}`,
    `Concluídas: ${done}`,
  ]
  if (failed > 0) lines.push(`Atenção: ${failed} task(s) com falha`)
  if (queue === 0 && running === 0 && review === 0 && failed === 0) {
    lines.push('Operação limpa: sem fila, sem revisão pendente e sem falhas abertas.')
  }
  return lines
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const limit = parseLimit(request)

    const countRows = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM tasks
      WHERE workspace_id = ?
      GROUP BY status
      ORDER BY status
    `).all(workspaceId) as CountRow[]
    const counts = Object.fromEntries(countRows.map(row => [row.status, row.count])) as Record<string, number>

    const agents = db.prepare(`
      SELECT
        a.name,
        a.role,
        a.status,
        COUNT(t.id) as total,
        SUM(CASE WHEN t.status IN ('awaiting_owner', 'assigned', 'in_progress') THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN t.status IN ('review', 'quality_review') THEN 1 ELSE 0 END) as review,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM agents a
      LEFT JOIN tasks t ON t.assigned_to = a.name AND t.workspace_id = a.workspace_id
      WHERE a.workspace_id = ? AND a.name IN (${CANONICAL_CITARA_AGENTS.map(() => '?').join(',')})
      GROUP BY a.id
      ORDER BY a.name
    `).all(workspaceId, ...CANONICAL_CITARA_AGENTS) as AgentRow[]

    const recentTasks = db.prepare(`
      SELECT id, title, status, priority, assigned_to, updated_at, resolution, error_message
      FROM tasks
      WHERE workspace_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(workspaceId, limit) as TaskRow[]

    const byTopic = agents.map(agent => ({
      topic: TOPIC_BY_AGENT[agent.name] || agent.name.replace(/^Cítara\s+/, ''),
      agent: agent.name,
      role: agent.role,
      status: 'Hermes Adapter queue-ready',
      tasks: {
        total: Number(agent.total || 0),
        active: Number(agent.active || 0),
        review: Number(agent.review || 0),
        done: Number(agent.done || 0),
        failed: Number(agent.failed || 0),
      },
      signal: Number(agent.failed || 0) > 0 ? 'attention' : Number(agent.active || 0) > 0 ? 'working' : 'clear',
    }))

    const report = {
      ok: true,
      generated_at: new Date().toISOString(),
      workspace_id: workspaceId,
      title: 'Resumo do General — Cítara Mission Control',
      summary: buildExecutiveSummary(counts, agents),
      counts,
      topics: byTopic,
      recent_tasks: recentTasks.map(task => ({
        ...task,
        updated_at_iso: new Date(Number(task.updated_at || 0) * 1000).toISOString(),
      })),
      next_actions: [
        counts.awaiting_owner ? 'Rodar Fleet Runner para processar fila awaiting_owner.' : null,
        counts.quality_review ? 'Revisar tasks em quality_review e aprovar/concluir.' : null,
        counts.failed ? 'Abrir tasks failed e corrigir causa antes de reenfileirar.' : null,
        !counts.awaiting_owner && !counts.quality_review && !counts.failed ? 'Criar próxima task real por agente/cliente ou importar de ClickUp/WhatsApp.' : null,
      ].filter(Boolean),
    }

    return NextResponse.json(report)
  } catch (error) {
    logger.error({ err: error }, 'GET /api/citara/general-report error')
    return NextResponse.json({ error: 'Failed to build Cítara General report' }, { status: 500 })
  }
}
