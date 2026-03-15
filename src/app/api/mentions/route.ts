import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getMentionTargets } from '@/lib/mentions'
import { logger } from '@/lib/logger'

/**
 * GET /api/mentions - autocomplete source for @mentions (users + agents + teams)
 * Query: q?, limit?, type?
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)

    const q = String(searchParams.get('q') || '').trim().toLowerCase()
    const typeFilter = String(searchParams.get('type') || '').trim().toLowerCase()
    const limitRaw = Number.parseInt(searchParams.get('limit') || '25', 10)
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 25, 200))

    let targets = getMentionTargets(db, workspaceId)

    if (typeFilter === 'user' || typeFilter === 'agent' || typeFilter === 'team') {
      targets = targets.filter((target) => target.type === typeFilter)
    }

    if (q) {
      targets = targets.filter((target) => (
        target.handle.includes(q) ||
        target.recipient.toLowerCase().includes(q) ||
        target.display.toLowerCase().includes(q)
      ))
    }

    targets = targets.slice(0, limit)

    return NextResponse.json({
      mentions: targets,
      total: targets.length,
      q,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/mentions error')
    return NextResponse.json({ error: 'Failed to fetch mention targets' }, { status: 500 })
  }
}
