import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'

interface RelationshipRow {
  id: number
  source_agent_id: number
  target_agent_id: number
  type: string
  metadata: string | null
  workspace_id: number
  created_at: number
  updated_at: number
  source_name?: string
  target_name?: string
}

/**
 * GET /api/spatial/relationships - List agent relationships
 * Query params: type, agent_id
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const agentId = searchParams.get('agent_id')

  let query = `
    SELECT r.*, a1.name as source_name, a2.name as target_name
    FROM agent_relationships r
    JOIN agents a1 ON r.source_agent_id = a1.id
    JOIN agents a2 ON r.target_agent_id = a2.id
    WHERE r.workspace_id = ?
  `
  const params: (string | number)[] = [workspaceId]

  if (type) {
    query += ' AND r.type = ?'
    params.push(type)
  }

  if (agentId) {
    const id = parseInt(agentId, 10)
    if (!isNaN(id)) {
      query += ' AND (r.source_agent_id = ? OR r.target_agent_id = ?)'
      params.push(id, id)
    }
  }

  query += ' ORDER BY r.created_at DESC'

  const relationships = db.prepare(query).all(...params) as RelationshipRow[]

  return NextResponse.json({ relationships })
}

/**
 * POST /api/spatial/relationships - Create a relationship
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  let body: { source_agent_id?: number; target_agent_id?: number; type?: string; metadata?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { source_agent_id, target_agent_id, type, metadata } = body

  if (!source_agent_id || !target_agent_id || !type) {
    return NextResponse.json({ error: 'source_agent_id, target_agent_id, and type are required' }, { status: 400 })
  }

  if (!['delegation', 'communication', 'supervision'].includes(type)) {
    return NextResponse.json({ error: 'type must be delegation, communication, or supervision' }, { status: 400 })
  }

  if (source_agent_id === target_agent_id) {
    return NextResponse.json({ error: 'Cannot create self-relationship' }, { status: 400 })
  }

  // Validate both agents exist in workspace
  const sourceAgent = db.prepare('SELECT id, name FROM agents WHERE id = ? AND workspace_id = ?').get(source_agent_id, workspaceId) as { id: number; name: string } | undefined
  const targetAgent = db.prepare('SELECT id, name FROM agents WHERE id = ? AND workspace_id = ?').get(target_agent_id, workspaceId) as { id: number; name: string } | undefined

  if (!sourceAgent) {
    return NextResponse.json({ error: `Source agent ${source_agent_id} not found` }, { status: 404 })
  }
  if (!targetAgent) {
    return NextResponse.json({ error: `Target agent ${target_agent_id} not found` }, { status: 404 })
  }

  try {
    const result = db.prepare(`
      INSERT INTO agent_relationships (source_agent_id, target_agent_id, type, metadata, workspace_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(source_agent_id, target_agent_id, type, metadata ? JSON.stringify(metadata) : null, workspaceId)

    const relationship = db.prepare('SELECT * FROM agent_relationships WHERE id = ?').get(result.lastInsertRowid) as RelationshipRow

    eventBus.broadcast('spatial.edge.added', {
      edgeId: `rel-${relationship.id}`,
      sourceAgentId: source_agent_id,
      targetAgentId: target_agent_id,
      type,
    })

    return NextResponse.json({ relationship }, { status: 201 })
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      return NextResponse.json({ error: 'Relationship already exists' }, { status: 409 })
    }
    throw err
  }
}
