import { getErrorMessage } from '@/lib/types/sql'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody, githubSyncSchema } from '@/lib/validation'
import { getGitHubToken, fetchIssues } from '@/lib/github'
import { handleSync, handleComment, handleClose, handleInitLabels, handleSyncProject } from './sync-helpers'
import { handleGitHubStats, handleStatus } from './github-stats'

/**
 * GET /api/github?action=issues&repo=owner/repo&state=open&labels=bug
 * Fetch issues from GitHub for preview before import.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')

    if (action === 'stats') {
      return await handleGitHubStats()
    }

    if (action !== 'issues') {
      return NextResponse.json({ error: 'Unknown action. Use ?action=issues or ?action=stats' }, { status: 400 })
    }

    const repo = searchParams.get('repo') || process.env.GITHUB_DEFAULT_REPO
    if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
      return NextResponse.json({ error: 'repo query parameter required (owner/repo format)' }, { status: 400 })
    }

    const token = getGitHubToken()
    if (!token) {
      return NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 400 })
    }

    const state = (searchParams.get('state') as 'open' | 'closed' | 'all') || 'open'
    const labels = searchParams.get('labels') || undefined

    const issues = await fetchIssues(repo, { state, labels, per_page: 50 })

    return NextResponse.json({ issues, total: issues.length, repo })
  } catch (error: unknown) {
    logger.error({ err: error }, 'GET /api/github error')
    return NextResponse.json({ error: getErrorMessage(error) || 'Failed to fetch issues' }, { status: 500 })
  }
}

/**
 * POST /api/github — Action dispatcher for sync, comment, close, status.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const validated = await validateBody(request, githubSyncSchema)
  if ('error' in validated) return validated.error

  const body = validated.data
  const { action } = body

  try {
    switch (action) {
      case 'sync':
        return await handleSync(body, auth.user.username, auth.user.workspace_id ?? 1)
      case 'comment':
        return await handleComment(body, auth.user.username, auth.user.workspace_id ?? 1)
      case 'close':
        return await handleClose(body, auth.user.username, auth.user.workspace_id ?? 1)
      case 'status':
        return handleStatus(auth.user.workspace_id ?? 1)
      case 'init-labels':
        return await handleInitLabels(body, auth.user.workspace_id ?? 1)
      case 'sync-project':
        return await handleSyncProject(body, auth.user.username, auth.user.workspace_id ?? 1)
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error: unknown) {
    logger.error({ err: error }, `POST /api/github action=${action} error`)
    return NextResponse.json({ error: getErrorMessage(error) || 'GitHub action failed' }, { status: 500 })
  }
}
