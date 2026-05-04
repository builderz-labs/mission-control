import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { listCoordinatedAgents, summarizeAgentState, findAgent } from '@/lib/agent-coordination'

/**
 * GET /api/mission-control/agents
 *
 * Returns the coordination registry snapshot: a summary overview and the full
 * agent list. Read-only — no execution, no mutation.
 *
 * Query params:
 *   ?id=<agent-id>  Return a single agent record instead of the full list.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (id) {
    const agent = findAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found.' }, { status: 404 })
    }
    return NextResponse.json({ agent })
  }

  const agents = listCoordinatedAgents()
  const summary = summarizeAgentState(agents)

  return NextResponse.json({ summary, agents })
}
