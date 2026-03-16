import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'

interface RelationshipRow {
  id: number
  source_agent_id: number
  target_agent_id: number
  type: string
  workspace_id: number
}

/**
 * DELETE /api/spatial/relationships/[id] - Delete a relationship
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const relationshipId = parseInt(id, 10)
  if (isNaN(relationshipId)) {
    return NextResponse.json({ error: 'Invalid relationship ID' }, { status: 400 })
  }

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  const existing = db.prepare(
    'SELECT * FROM agent_relationships WHERE id = ? AND workspace_id = ?'
  ).get(relationshipId, workspaceId) as RelationshipRow | undefined

  if (!existing) {
    return NextResponse.json({ error: 'Relationship not found' }, { status: 404 })
  }

  db.prepare('DELETE FROM agent_relationships WHERE id = ? AND workspace_id = ?').run(relationshipId, workspaceId)

  eventBus.broadcast('spatial.edge.removed', { edgeId: `rel-${relationshipId}` })

  return NextResponse.json({ success: true })
}
