import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { inventoryForAgent, inventoryLooksSafe } from '@/lib/cli-inventory'
import { isFleetAgentName } from '@/lib/fleet-agents'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  const agent = Number.isNaN(Number(id))
    ? db.prepare('SELECT id, name FROM agents WHERE name = ? AND workspace_id = ?').get(id, workspaceId) as { id: number; name: string } | undefined
    : db.prepare('SELECT id, name FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId) as { id: number; name: string } | undefined
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (!isFleetAgentName(agent.name)) {
    return NextResponse.json({ error: 'Inventory is limited to fleet identities' }, { status: 400 })
  }
  const inventory = inventoryForAgent(agent.name)
  if (!inventoryLooksSafe(inventory)) {
    return NextResponse.json({ error: 'Inventory contained unsafe fields' }, { status: 500 })
  }
  return NextResponse.json(inventory)
}
