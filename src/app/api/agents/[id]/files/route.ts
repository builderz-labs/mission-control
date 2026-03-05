import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { getAgentWorkspace, listWorkspaceFiles } from '@/lib/agent-workspace'

/**
 * GET /api/agents/[id]/files - List all .md files in the agent's workspace root
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const agentId = resolvedParams.id

    // Get agent by ID or name
    let agent: any
    if (isNaN(Number(agentId))) {
      agent = db.prepare('SELECT id, name, role FROM agents WHERE name = ?').get(agentId)
    } else {
      agent = db.prepare('SELECT id, name, role FROM agents WHERE id = ?').get(Number(agentId))
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const workspace = getAgentWorkspace(agentId)
    if (!workspace) {
      return NextResponse.json({
        agent: { id: agent.id, name: agent.name },
        workspace: null,
        files: [],
        message: 'No workspace configured for this agent'
      })
    }

    const files = listWorkspaceFiles(workspace)

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name },
      workspace,
      files
    })
  } catch (error) {
    console.error('GET /api/agents/[id]/files error:', error)
    return NextResponse.json({ error: 'Failed to list workspace files' }, { status: 500 })
  }
}
