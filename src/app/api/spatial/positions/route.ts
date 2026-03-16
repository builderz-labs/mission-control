import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, writeTransaction } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'

interface PositionRow {
  agent_id: number
  x: number
  y: number
}

/**
 * GET /api/spatial/positions - Get all saved agent positions
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  const positions = db.prepare(
    'SELECT agent_id, x, y FROM spatial_positions WHERE workspace_id = ?'
  ).all(workspaceId) as PositionRow[]

  return NextResponse.json({ positions })
}

/**
 * PUT /api/spatial/positions - Batch upsert agent positions
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { positions?: { agent_id: number; x: number; y: number }[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { positions } = body
  if (!Array.isArray(positions) || positions.length === 0) {
    return NextResponse.json({ error: 'positions array is required' }, { status: 400 })
  }

  // Validate entries
  for (const pos of positions) {
    if (typeof pos.agent_id !== 'number' || typeof pos.x !== 'number' || typeof pos.y !== 'number') {
      return NextResponse.json({ error: 'Each position must have agent_id, x, y as numbers' }, { status: 400 })
    }
  }

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  // Validate all agent_ids exist in this workspace
  const agentIds = positions.map((p) => p.agent_id)
  const placeholders = agentIds.map(() => '?').join(',')
  const validAgents = db.prepare(
    `SELECT id FROM agents WHERE id IN (${placeholders}) AND workspace_id = ?`
  ).all(...agentIds, workspaceId) as Array<{ id: number }>
  const validIds = new Set(validAgents.map((a) => a.id))
  const invalidIds = agentIds.filter((id) => !validIds.has(id))
  if (invalidIds.length > 0) {
    return NextResponse.json(
      { error: `Agent(s) not found in workspace: ${invalidIds.join(', ')}` },
      { status: 400 }
    )
  }

  const count = writeTransaction(db, (txDb) => {
    const stmt = txDb.prepare(`
      INSERT INTO spatial_positions (agent_id, x, y, workspace_id, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(agent_id) DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = unixepoch()
    `)

    let inserted = 0
    for (const pos of positions) {
      stmt.run(pos.agent_id, pos.x, pos.y, workspaceId)
      inserted++
    }
    return inserted
  })

  eventBus.broadcast('spatial.positions.updated', { count })

  return NextResponse.json({ success: true, count })
}
