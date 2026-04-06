import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getDatabase } from '@/lib/db'
import { BrowserAgent } from '@/lib/browser'

const BrowseSchema = z.object({
  url: z.string().url(),
  screenshot: z.boolean().optional().default(false),
  extractSelector: z.string().optional(),
  timeout: z.number().int().min(1000).max(60000).optional().default(15000),
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
  const rateLimited = mutationLimiter(req)
  if (rateLimited) return rateLimited

  const auth = requireRole(req, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const validated = await validateBody(req, BrowseSchema)
  if ('error' in validated) return validated.error

  try {
    const { id: agentId } = await params
    const agent = BrowserAgent.getInstance()
    const result = await agent.navigate(validated.data.url, {
      ...validated.data,
      agentId,
      // WHY: workspaceId from auth token only — never from request body
      workspaceId: auth.user.workspace_id,
    })

    return NextResponse.json({ data: result })
  } catch (err) {
    logger.error({ err }, 'Browse POST failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
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
  const rateLimited = readLimiter(req)
  if (rateLimited) return rateLimited

  const auth = requireRole(req, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id: agentId } = await params
    // WHY: workspaceId scoped to authenticated user — prevents cross-workspace audit access
    const workspaceId = auth.user.workspace_id

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
    logger.error({ err }, 'Browse GET failed')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
