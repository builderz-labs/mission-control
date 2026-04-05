import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { BrowserAgent } from '@/lib/browser'

const BrowseSchema = z.object({
  url: z.string().url(),
  screenshot: z.boolean().optional().default(false),
  extractSelector: z.string().optional(),
  timeout: z.number().int().min(1000).max(60000).optional().default(15000),
  workspaceId: z.number().int().positive().optional().default(1),
})

/**
 * POST /api/agents/[id]/browse
 * Triggers a browser session for the given agent, returns full BrowseResult.
 * WHY: Agents need to read live web content — this provides a self-healing,
 * audited fetch with optional screenshot capture.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = requireRole(req, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id: agentId } = await params
    const body: unknown = await req.json()
    const parsed = BrowseSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const agent = BrowserAgent.getInstance()
    const result = await agent.navigate(parsed.data.url, {
      ...parsed.data,
      agentId,
    })

    return NextResponse.json({ data: result })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/**
 * GET /api/agents/[id]/browse
 * Returns the 10 most recent browse sessions for the given agent.
 * WHY: Audit trail — operators can review what URLs an agent has visited.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = requireRole(req, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id: agentId } = await params
    const { searchParams } = new URL(req.url)
    const workspaceId = Number(searchParams.get('workspaceId') ?? String(auth.user.workspace_id ?? 1))

    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()
    const sessions = db
      .prepare(
        `SELECT id, url, status, started_at, completed_at
         FROM browse_sessions
         WHERE agent_id = ? AND workspace_id = ?
         ORDER BY started_at DESC LIMIT 10`
      )
      .all(agentId, workspaceId)

    return NextResponse.json({ data: sessions })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
