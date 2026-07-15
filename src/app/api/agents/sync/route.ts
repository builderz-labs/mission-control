import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { syncAgentsFromConfig, previewSyncDiff } from '@/lib/agent-sync'
import { syncLocalAgents } from '@/lib/local-agent-sync'
import { logger } from '@/lib/logger'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'

/**
 * POST /api/agents/sync - Trigger agent config sync
 * ?source=local triggers local disk scan instead of openclaw.json sync.
 * Requires admin role.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDeny = denyUnscopedResourceForStrictWorkspace(auth.user, 'runtime_configuration', new URL(request.url).pathname)
  if (isolationDeny) return isolationDeny

  const { searchParams } = new URL(request.url)
  const source = searchParams.get('source')

  try {
    if (source === 'local') {
      const result = await syncLocalAgents()
      return NextResponse.json(result)
    }

    const result = await syncAgentsFromConfig(auth.user.username)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json(result)
  } catch (error: any) {
    logger.error({ err: error }, 'POST /api/agents/sync error')
    return NextResponse.json({ error: error.message || 'Sync failed' }, { status: 500 })
  }
}

/**
 * GET /api/agents/sync - Preview diff between openclaw.json and MC
 * Shows what would change without writing.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDeny = denyUnscopedResourceForStrictWorkspace(auth.user, 'runtime_configuration', new URL(request.url).pathname)
  if (isolationDeny) return isolationDeny

  try {
    const diff = await previewSyncDiff()
    return NextResponse.json(diff)
  } catch (error: any) {
    logger.error({ err: error }, 'GET /api/agents/sync error')
    return NextResponse.json({ error: error.message || 'Preview failed' }, { status: 500 })
  }
}
