import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck
  const body = await request.json().catch(() => null)
  const operation = typeof body?.operation === 'string' ? body.operation.trim() : ''
  const agentId = typeof body?.agent_id === 'string' ? body.agent_id.trim() : ''
  const schedule = typeof body?.schedule === 'string' ? body.schedule.trim() : ''
  if (!operation || !agentId) return NextResponse.json({ error: 'operation and agent_id are required' }, { status: 400 })
  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  const agent = db.prepare('SELECT id, name FROM agents WHERE workspace_id = ? AND name = ?').get(workspaceId, agentId) as { id: number; name: string } | undefined
  if (!agent) return NextResponse.json({ error: `Agent ${agentId} not found` }, { status: 404 })
  const now = Math.floor(Date.now() / 1000)
  const metadata = { dispatch_source: 'lab', operation, agent_id: agentId, schedule: schedule || null }
  const result = db.prepare(`INSERT INTO tasks (title, description, status, priority, assigned_to, created_by, created_at, updated_at, metadata) VALUES (?, ?, 'inbox', 'medium', ?, ?, ?, ?, ?)`)
    .run(operation.slice(0, 200), operation, agentId, 'mission-control', now, now, JSON.stringify(metadata))
  logger.info({ taskId: result.lastInsertRowid, agentId, schedule }, 'Dispatched mission-control operation')
  return NextResponse.json({ ok: true, task_id: Number(result.lastInsertRowid), agent_id: agentId, agent_name: agent.name })
}
