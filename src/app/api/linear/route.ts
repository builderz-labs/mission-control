import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { fetchTeams, getLinearApiKey } from '@/lib/linear'
import { pullFromLinear } from '@/lib/linear-sync-engine'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const token = getLinearApiKey()
    if (!token) {
      return NextResponse.json({ error: 'LINEAR_API_KEY not configured' }, { status: 400 })
    }

    const teams = await fetchTeams()
    return NextResponse.json({ teams })
  } catch (error: any) {
    logger.error({ err: error }, 'GET /api/linear error')
    return NextResponse.json({ error: error.message || 'Failed to fetch Linear teams' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json()
  const { action, project_id } = body

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  try {
    switch (action) {
      case 'status': {
        const syncs = db.prepare(`
          SELECT * FROM linear_syncs
          WHERE workspace_id = ?
          ORDER BY created_at DESC
          LIMIT 20
        `).all(workspaceId)
        return NextResponse.json({ syncs })
      }

      case 'sync-project': {
        if (typeof project_id !== 'number') {
          return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
        }

        const project = db.prepare(`
          SELECT id, linear_team_id, linear_sync_enabled
          FROM projects
          WHERE id = ? AND workspace_id = ? AND status = 'active'
        `).get(project_id, workspaceId) as any | undefined

        if (!project) {
          return NextResponse.json({ error: 'Project not found' }, { status: 404 })
        }
        if (!project.linear_team_id || !project.linear_sync_enabled) {
          return NextResponse.json({ error: 'Linear sync not enabled for this project' }, { status: 400 })
        }

        const result = await pullFromLinear(project, workspaceId)
        return NextResponse.json({ ok: true, ...result })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error: any) {
    logger.error({ err: error }, `POST /api/linear action=${action} error`)
    return NextResponse.json({ error: error.message || 'Linear action failed' }, { status: 500 })
  }
}
