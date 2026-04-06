import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { pullFromGitHub } from '@/lib/github-sync-engine'
import { getSyncPollerStatus } from '@/lib/github-sync-poller'

/**
 * GET /api/github/sync — sync status for all GitHub-linked projects.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const syncs = db.prepare(`
      SELECT
        gs.project_id,
        p.name as project_name,
        p.github_repo,
        MAX(gs.last_synced_at) as last_synced_at,
        SUM(gs.changes_pushed) as total_pushed,
        SUM(gs.changes_pulled) as total_pulled,
        COUNT(*) as sync_count
      FROM github_syncs gs
      LEFT JOIN projects p ON p.id = gs.project_id AND p.workspace_id = gs.workspace_id
      WHERE gs.workspace_id = ? AND gs.project_id IS NOT NULL
      GROUP BY gs.project_id
      ORDER BY last_synced_at DESC
    `).all(workspaceId)

    const poller = getSyncPollerStatus()

    return NextResponse.json({ syncs, poller })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/github/sync error')
    return NextResponse.json({ error: 'Failed to fetch sync status' }, { status: 500 })
  }
}

/**
 * POST /api/github/sync — trigger sync manually.
 * Body: { action: 'trigger', project_id: number } or { action: 'trigger-all' }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: { action?: string; project_id?: unknown }
  try {
    body = await request.json()
  } catch {
    // WHY: Return 400 for malformed JSON, not 500 — this is a client error, not a server fault.
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const { action, project_id } = body
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    if (action === 'trigger' && typeof project_id === 'number') {
      const project = db.prepare(`
        SELECT id, github_repo, github_sync_enabled, github_default_branch
        FROM projects
        WHERE id = ? AND workspace_id = ? AND status = 'active'
      `).get(project_id, workspaceId) as any | undefined

      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      }
      if (!project.github_repo || !project.github_sync_enabled) {
        return NextResponse.json({ error: 'GitHub sync not enabled for this project' }, { status: 400 })
      }

      const result = await pullFromGitHub(project, workspaceId)
      return NextResponse.json({ ok: true, ...result })
    }

    if (action === 'trigger-all') {
      const projects = db.prepare(`
        SELECT id, github_repo, github_sync_enabled, github_default_branch
        FROM projects
        WHERE github_sync_enabled = 1 AND github_repo IS NOT NULL AND workspace_id = ? AND status = 'active'
      `).all(workspaceId) as any[]

      let totalPulled = 0
      let totalPushed = 0

      for (const project of projects) {
        try {
          const result = await pullFromGitHub(project, workspaceId)
          totalPulled += result.pulled
          totalPushed += result.pushed
        } catch (err) {
          logger.error({ err, projectId: project.id }, 'Trigger-all: project sync failed')
        }
      }

      return NextResponse.json({
        ok: true,
        projects_synced: projects.length,
        pulled: totalPulled,
        pushed: totalPushed,
      })
    }

    return NextResponse.json({ error: 'Unknown action. Use trigger or trigger-all' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/github/sync error')
    return NextResponse.json({ error: 'Sync trigger failed' }, { status: 500 })
  }
}
