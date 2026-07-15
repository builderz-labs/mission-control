import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { createRef, getRef, fetchPullRequests, createPullRequest } from '@/lib/github'

function slugify(title: string, maxLen: number): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    .replace(/-$/, '')
}

/**
 * GET /api/tasks/[id]/branch - Get branch and PR status for a task
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
    const taskId = parseInt(resolvedParams.id)
    const workspaceId = auth.user.workspace_id ?? 1

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const task = db.prepare(`
      SELECT t.*, p.github_repo, p.github_default_branch, p.ticket_prefix
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ?
    `).get(taskId, workspaceId) as any

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const result: Record<string, unknown> = {
      branch: task.github_branch || null,
      pr_number: task.github_pr_number || null,
      pr_state: task.github_pr_state || null,
      repo: task.github_repo || null,
    }

    // If task has a branch but no PR info, check GitHub (fire-and-forget)
    if (task.github_branch && !task.github_pr_number && task.github_repo) {
      const repo = task.github_repo as string
      const branch = task.github_branch as string
      fetchPullRequests(repo, { head: branch, state: 'all' })
        .then((prs) => {
          if (prs.length > 0) {
            const pr = prs[0]
            db.prepare(`
              UPDATE tasks SET github_pr_number = ?, github_pr_state = ?, updated_at = ?
              WHERE id = ? AND workspace_id = ?
            `).run(pr.number, pr.state, Math.floor(Date.now() / 1000), taskId, workspaceId)
          }
        })
        .catch((err) => {
          logger.warn({ err }, 'Failed to check PRs for task branch')
        })
    }

    return NextResponse.json(result)
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/[id]/branch error')
    return NextResponse.json({ error: 'Failed to fetch branch info' }, { status: 500 })
  }
}

/**
 * POST /api/tasks/[id]/branch - Create a branch or PR for a task
 *
 * Body: {} to create a branch
 * Body: { action: 'create-pr', base?, title?, body? } to create a PR
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const resolvedParams = await params
    const taskId = parseInt(resolvedParams.id)
    const workspaceId = auth.user.workspace_id ?? 1

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 })
    }

    const task = db.prepare(`
      SELECT t.*, p.github_repo, p.github_default_branch, p.ticket_prefix
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ?
    `).get(taskId, workspaceId) as any

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (!task.github_repo) {
      return NextResponse.json(
        { error: 'Task project does not have a GitHub repo configured' },
        { status: 400 }
      )
    }

    const repo = task.github_repo as string
    const defaultBranch = (task.github_default_branch as string) || 'main'

    let body: Record<string, unknown> = {}
    try {
      body = await request.json()
    } catch {
      // empty body is fine for branch creation
    }

    // --- Create PR ---
    if (body.action === 'create-pr') {
      if (!task.github_branch) {
        return NextResponse.json(
          { error: 'Task does not have a branch yet. Create a branch first.' },
          { status: 400 }
        )
      }

      const prTitle = (body.title as string) || `${task.ticket_prefix ? task.ticket_prefix + ': ' : ''}${task.title}`
      const prBody = (body.body as string) || `Resolves task #${taskId}`
      const prBase = (body.base as string) || defaultBranch

      const pr = await createPullRequest(repo, {
        title: prTitle,
        head: task.github_branch,
        base: prBase,
        body: prBody,
      })

      const now = Math.floor(Date.now() / 1000)
      db.prepare(`
        UPDATE tasks SET github_pr_number = ?, github_pr_state = 'open', updated_at = ?
        WHERE id = ? AND workspace_id = ?
      `).run(pr.number, now, taskId, workspaceId)

      db_helpers.logActivity(
        'task_updated',
        'task',
        taskId,
        auth.user.username,
        `Created PR #${pr.number} for task`,
        { pr_number: pr.number, pr_url: pr.html_url },
        workspaceId
      )

      eventBus.broadcast('task.updated', {
        workspace_id: workspaceId,
        id: taskId,
        github_pr_number: pr.number,
        github_pr_state: 'open',
      })

      return NextResponse.json({
        pr_number: pr.number,
        pr_url: pr.html_url,
        branch: task.github_branch,
      })
    }

    // --- Create Branch ---

    // Idempotent: if branch already exists, return it
    if (task.github_branch) {
      return NextResponse.json({
        branch: task.github_branch,
        url: `https://github.com/${repo}/tree/${task.github_branch}`,
      })
    }

    // Build branch name: feat/{prefix}-{issue_or_id}-{slug}
    const prefix = task.ticket_prefix
      ? (task.ticket_prefix as string).toLowerCase()
      : 'task'
    const identifier = task.github_issue_number || taskId
    const basePrefix = `feat/${prefix}-${identifier}-`
    const maxSlugLen = 60 - basePrefix.length
    const slug = slugify(task.title || 'untitled', Math.max(maxSlugLen, 1))
    const branchName = `${basePrefix}${slug}`.slice(0, 60)

    // Get base branch SHA
    const { sha } = await getRef(repo, `heads/${defaultBranch}`)

    // Create the branch
    await createRef(repo, `refs/heads/${branchName}`, sha)

    const now = Math.floor(Date.now() / 1000)
    db.prepare(`
      UPDATE tasks SET github_branch = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?
    `).run(branchName, now, taskId, workspaceId)

    db_helpers.logActivity(
      'task_updated',
      'task',
      taskId,
      auth.user.username,
      `Created branch ${branchName} for task`,
      { branch: branchName, repo },
      workspaceId
    )

    eventBus.broadcast('task.updated', {
      workspace_id: workspaceId,
      id: taskId,
      github_branch: branchName,
    })

    return NextResponse.json({
      branch: branchName,
      url: `https://github.com/${repo}/tree/${branchName}`,
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/branch error')
    const message = error instanceof Error ? error.message : 'Failed to create branch'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
