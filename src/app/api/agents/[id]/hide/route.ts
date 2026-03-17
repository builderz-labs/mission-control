import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

/**
 * POST /api/agents/[id]/hide - Hide an agent from the UI
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1

    const idNum = Number(id)
    const agent = isNaN(idNum)
      ? db.prepare('SELECT id, name FROM agents WHERE name = ? AND workspace_id = ?').get(id, workspaceId) as any
      : db.prepare('SELECT id, name FROM agents WHERE id = ? AND workspace_id = ?').get(idNum, workspaceId) as any

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    db.prepare('UPDATE agents SET hidden = 1, updated_at = unixepoch() WHERE id = ?').run(agent.id)

    return NextResponse.json({ success: true, agent_id: agent.id, hidden: true })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/[id]/hide error')
    return NextResponse.json({ error: 'Failed to hide agent' }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/[id]/hide - Unhide an agent
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1

    const idNum = Number(id)
    const agent = isNaN(idNum)
      ? db.prepare('SELECT id, name FROM agents WHERE name = ? AND workspace_id = ?').get(id, workspaceId) as any
      : db.prepare('SELECT id, name FROM agents WHERE id = ? AND workspace_id = ?').get(idNum, workspaceId) as any

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    db.prepare('UPDATE agents SET hidden = 0, updated_at = unixepoch() WHERE id = ?').run(agent.id)

    return NextResponse.json({ success: true, agent_id: agent.id, hidden: false })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/agents/[id]/hide error')
    return NextResponse.json({ error: 'Failed to unhide agent' }, { status: 500 })
  }
}
