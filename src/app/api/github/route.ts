import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, Task, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateBody, githubSyncSchema } from '@/lib/validation'
import {
  getGitHubToken,
  fetchIssues,
  fetchIssue,
  createIssueComment,
  updateIssueState,
  type GitHubIssue,
} from '@/lib/github'

/**
 * GET /api/github?action=issues&repo=owner/repo&state=open&labels=bug
 * Fetch issues from GitHub for preview before import.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')

    if (action !== 'issues') {
      return NextResponse.json({ error: 'Unknown action. Use ?action=issues' }, { status: 400 })
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
  } catch (error: any) {
    logger.error({ err: error }, 'GET /api/github error')
    return NextResponse.json({ error: error.message || 'Failed to fetch issues' }, { status: 500 })
  }
}

/**
 * POST /api/github — Action dispatcher for sync, comment, close, status.
 */
export async function POST(request: NextRequest) {
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
        return await handleSync(body, auth.user.username)
      case 'comment':
        return await handleComment(body, auth.user.username)
      case 'close':
        return await handleClose(body, auth.user.username)
      case 'status':
        return handleStatus()
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error: any) {
    logger.error({ err: error }, `POST /api/github action=${action} error`)
    return NextResponse.json({ error: error.message || 'GitHub action failed' }, { status: 500 })
  }
}

// ── Sync: import GitHub issues as MC tasks ──────────────────────

async function handleSync(
  body: { repo?: string; labels?: string; state?: 'open' | 'closed' | 'all'; assignAgent?: string },
  actor: string
) {
  const repo = body.repo || process.env.GITHUB_DEFAULT_REPO
  if (!repo) {
    return NextResponse.json({ error: 'repo is required' }, { status: 400 })
  }

  const token = getGitHubToken()
  if (!token) {
    return NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 400 })
  }

  const issues = await fetchIssues(repo, {
    state: body.state || 'open',
    labels: body.labels,
    per_page: 100,
  })

  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  let imported = 0
  let skipped = 0
  let errors = 0
  const createdTasks: any[] = []

  for (const issue of issues) {
    try {
      // Check for duplicate: existing task with same github_repo + github_issue_number
      const existing = db.prepare(`
        SELECT id FROM tasks
        WHERE json_extract(metadata, '$.github_repo') = ?
          AND json_extract(metadata, '$.github_issue_number') = ?
      `).get(repo, issue.number) as { id: number } | undefined

      if (existing) {
        skipped++
        continue
      }

      // Map priority from labels
      const priority = mapPriority(issue.labels.map(l => l.name))
      const tags = issue.labels.map(l => l.name)
      const status = issue.state === 'closed' ? 'done' : 'inbox'

      const metadata = {
        github_repo: repo,
        github_issue_number: issue.number,
        github_issue_url: issue.html_url,
        github_synced_at: new Date().toISOString(),
        github_state: issue.state,
      }

      const stmt = db.prepare(`
        INSERT INTO tasks (
          title, description, status, priority, assigned_to, created_by,
          created_at, updated_at, tags, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const dbResult = stmt.run(
        issue.title,
        issue.body || '',
        status,
        priority,
        body.assignAgent || null,
        actor,
        now,
        now,
        JSON.stringify(tags),
        JSON.stringify(metadata)
      )

      const taskId = dbResult.lastInsertRowid as number

      db_helpers.logActivity(
        'task_created',
        'task',
        taskId,
        actor,
        `Imported from GitHub: ${repo}#${issue.number}`,
        { github_issue: issue.number, github_repo: repo }
      )

      const createdTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task
      const parsedTask = {
        ...createdTask,
        tags: JSON.parse(createdTask.tags || '[]'),
        metadata: JSON.parse(createdTask.metadata || '{}'),
      }

      eventBus.broadcast('task.created', parsedTask)
      createdTasks.push(parsedTask)
      imported++
    } catch (err: any) {
      logger.error({ err, issue: issue.number }, 'Failed to import GitHub issue')
      errors++
    }
  }

  // Log sync to github_syncs table
  db.prepare(`
    INSERT INTO github_syncs (repo, last_synced_at, issue_count, sync_direction, status, error)
    VALUES (?, ?, ?, 'inbound', ?, ?)
  `).run(
    repo,
    now,
    imported,
    errors > 0 ? 'partial' : 'success',
    errors > 0 ? `${errors} issues failed to import` : null
  )

  eventBus.broadcast('github.synced', {
    repo,
    imported,
    skipped,
    errors,
    timestamp: now,
  })

  return NextResponse.json({
    imported,
    skipped,
    errors,
    tasks: createdTasks,
  })
}

// ── Comment: post a comment on a GitHub issue ───────────────────

async function handleComment(
  body: { repo?: string; issueNumber?: number; body?: string },
  actor: string
) {
  if (!body.repo || !body.issueNumber || !body.body) {
    return NextResponse.json(
      { error: 'repo, issueNumber, and body are required' },
      { status: 400 }
    )
  }

  await createIssueComment(body.repo, body.issueNumber, body.body)

  db_helpers.logActivity(
    'github_comment',
    'task',
    0,
    actor,
    `Commented on ${body.repo}#${body.issueNumber}`,
    { github_repo: body.repo, github_issue: body.issueNumber }
  )

  return NextResponse.json({ ok: true })
}

// ── Close: close a GitHub issue ─────────────────────────────────

async function handleClose(
  body: { repo?: string; issueNumber?: number; comment?: string },
  actor: string
) {
  if (!body.repo || !body.issueNumber) {
    return NextResponse.json(
      { error: 'repo and issueNumber are required' },
      { status: 400 }
    )
  }

  // Optionally post a closing comment first
  if (body.comment) {
    await createIssueComment(body.repo, body.issueNumber, body.comment)
  }

  await updateIssueState(body.repo, body.issueNumber, 'closed')

  // Update local task metadata if we have a linked task
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE tasks
    SET metadata = json_set(metadata, '$.github_state', 'closed'),
        updated_at = ?
    WHERE json_extract(metadata, '$.github_repo') = ?
      AND json_extract(metadata, '$.github_issue_number') = ?
  `).run(now, body.repo, body.issueNumber)

  db_helpers.logActivity(
    'github_close',
    'task',
    0,
    actor,
    `Closed GitHub issue ${body.repo}#${body.issueNumber}`,
    { github_repo: body.repo, github_issue: body.issueNumber }
  )

  return NextResponse.json({ ok: true })
}

// ── Status: return recent sync history ──────────────────────────

function handleStatus() {
  const db = getDatabase()
  const syncs = db.prepare(`
    SELECT * FROM github_syncs
    ORDER BY created_at DESC
    LIMIT 20
  `).all()

  return NextResponse.json({ syncs })
}

// ── Priority mapping helper ─────────────────────────────────────

function mapPriority(labels: string[]): 'critical' | 'high' | 'medium' | 'low' {
  for (const label of labels) {
    const lower = label.toLowerCase()
    if (lower === 'priority:critical' || lower === 'critical') return 'critical'
    if (lower === 'priority:high' || lower === 'high') return 'high'
    if (lower === 'priority:low' || lower === 'low') return 'low'
    if (lower === 'priority:medium') return 'medium'
  }
  return 'medium'
}
