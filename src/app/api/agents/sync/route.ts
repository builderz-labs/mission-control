import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { syncAgentsFromConfig, previewSyncDiff } from '@/lib/agent-sync'

/**
 * POST /api/agents/sync - Trigger agent config sync from openclaw.json
 * Requires admin role.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const result = await syncAgentsFromConfig(auth.user.username)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('POST /api/agents/sync error:', error)
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

  try {
    const diff = await previewSyncDiff()
    return NextResponse.json(diff)
  } catch (error: any) {
    console.error('GET /api/agents/sync error:', error)
    return NextResponse.json({ error: error.message || 'Preview failed' }, { status: 500 })
  }
}
