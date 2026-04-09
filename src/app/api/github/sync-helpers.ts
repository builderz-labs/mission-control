import { NextResponse } from 'next/server'
import { getDatabase, Task, db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'
import {
  getGitHubToken,
  fetchIssues,
  createIssueComment,
  updateIssueState,
} from '@/lib/github'
import { initializeLabels, pullFromGitHub } from '@/lib/github-sync-engine'

interface ProjectSyncRow {
  id: number
  github_repo: string | null
  github_sync_enabled: number | null
  github_default_branch: string | null
}

export async function handleSync(
  body: { repo?: string; labels?: string; state?: 'open' | 'closed' | 'all'; assignAgent?: string },
  actor: string,
  workspaceId: number
): Promise<NextResponse> {
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
  const createdTasks: Array<Record<string, unknown>> = []

  for (const issue of issues) {
    try {
      // Check for duplicate: existing task linked via DB columns (created by sync-engine)
      // OR via legacy metadata JSON (created by handleSync before this fix).
      // WHY: Two code paths create GitHub-linked tasks; dedup must cover both to avoid ghost imports.
      const existing = db.prepare(`
        SELECT id FROM tasks
        WHERE (
          (github_repo = ? AND github_issue_number = ?)
          OR (json_extract(metadata, '$.github_repo') = ? AND json_extract(metadata, '$.github_issue_number') = ?)
        ) AND workspace_id = ?
      `).get(repo, issue.number, repo, issue.number, workspaceId) as { id: number } | undefined

      if (existing) { skipped++; continue }

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

      // WHY: Populate DB columns (not just metadata JSON) so tasks created by handleSync
      // participate in the bidirectional sync engine's queries, which rely on DB columns.
      const dbResult = db.prepare(`
        INSERT INTO tasks (
          title, description, status, priority, assigned_to, created_by,
          created_at, updated_at, tags, metadata, workspace_id,
          github_issue_number, github_repo, github_synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        issue.title, issue.body || '', status, priority,
        body.assignAgent || null, actor, now, now,
        JSON.stringify(tags), JSON.stringify(metadata), workspaceId,
        issue.number, repo, now
      )

      const taskId = dbResult.lastInsertRowid as number

      db_helpers.logActivity(
        'task_created', 'task', taskId, actor,
        `Imported from GitHub: ${repo}#${issue.number}`,
        { github_issue: issue.number, github_repo: repo },
        workspaceId
      )

      const createdTask = db.prepare('SELECT id, title, description, status, priority, assigned_to, created_by, created_at, updated_at, due_date, estimated_hours, actual_hours, tags, metadata, workspace_id, project_id, project_ticket_no, outcome, error_message, resolution, feedback_rating, feedback_notes, retry_count, completed_at, github_issue_number, github_repo, github_synced_at, github_branch, github_pr_number, github_pr_state FROM tasks WHERE id = ? AND workspace_id = ?').get(taskId, workspaceId) as Task
      const parsedTask = {
        ...createdTask,
        tags: JSON.parse(createdTask.tags || '[]'),
        metadata: JSON.parse(createdTask.metadata || '{}'),
      }

      eventBus.broadcast('task.created', parsedTask)
      createdTasks.push(parsedTask)
      imported++
    } catch (err: unknown) {
      logger.error({ err, issue: issue.number }, 'Failed to import GitHub issue')
      errors++
    }
  }

  // Log sync to github_syncs table
  const syncTableHasWorkspace = db
    .prepare("SELECT 1 as ok FROM pragma_table_info('github_syncs') WHERE name = 'workspace_id'")
    .get() as { ok?: number } | undefined
  if (syncTableHasWorkspace?.ok) {
    db.prepare(`
      INSERT INTO github_syncs (repo, last_synced_at, issue_count, sync_direction, status, error, workspace_id)
      VALUES (?, ?, ?, 'inbound', ?, ?, ?)
    `).run(repo, now, imported, errors > 0 ? 'partial' : 'success', errors > 0 ? `${errors} issues failed to import` : null, workspaceId)
  } else {
    db.prepare(`
      INSERT INTO github_syncs (repo, last_synced_at, issue_count, sync_direction, status, error)
      VALUES (?, ?, ?, 'inbound', ?, ?)
    `).run(repo, now, imported, errors > 0 ? 'partial' : 'success', errors > 0 ? `${errors} issues failed to import` : null)
  }

  eventBus.broadcast('github.synced', { repo, imported, skipped, errors, timestamp: now })

  return NextResponse.json({ imported, skipped, errors, tasks: createdTasks })
}

export async function handleComment(
  body: { repo?: string; issueNumber?: number; body?: string },
  actor: string,
  workspaceId: number
): Promise<NextResponse> {
  if (!body.repo || !body.issueNumber || !body.body) {
    return NextResponse.json({ error: 'repo, issueNumber, and body are required' }, { status: 400 })
  }

  await createIssueComment(body.repo, body.issueNumber, body.body)

  db_helpers.logActivity(
    'github_comment', 'task', 0, actor,
    `Commented on ${body.repo}#${body.issueNumber}`,
    { github_repo: body.repo, github_issue: body.issueNumber },
    workspaceId
  )

  return NextResponse.json({ ok: true })
}

export async function handleClose(
  body: { repo?: string; issueNumber?: number; comment?: string },
  actor: string,
  workspaceId: number
): Promise<NextResponse> {
  if (!body.repo || !body.issueNumber) {
    return NextResponse.json({ error: 'repo and issueNumber are required' }, { status: 400 })
  }

  if (body.comment) {
    await createIssueComment(body.repo, body.issueNumber, body.comment)
  }

  await updateIssueState(body.repo, body.issueNumber, 'closed')

  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE tasks
    SET metadata = json_set(metadata, '$.github_state', 'closed'),
        updated_at = ?
    WHERE json_extract(metadata, '$.github_repo') = ?
      AND json_extract(metadata, '$.github_issue_number') = ?
      AND workspace_id = ?
  `).run(now, body.repo, body.issueNumber, workspaceId)

  db_helpers.logActivity(
    'github_close', 'task', 0, actor,
    `Closed GitHub issue ${body.repo}#${body.issueNumber}`,
    { github_repo: body.repo, github_issue: body.issueNumber },
    workspaceId
  )

  return NextResponse.json({ ok: true })
}

export async function handleInitLabels(
  body: { repo?: string },
  workspaceId: number
): Promise<NextResponse> {
  const repo = body.repo || process.env.GITHUB_DEFAULT_REPO
  if (!repo) {
    return NextResponse.json({ error: 'repo is required' }, { status: 400 })
  }

  await initializeLabels(repo)

  const db = getDatabase()
  db.prepare(`
    UPDATE projects
    SET github_labels_initialized = 1, updated_at = unixepoch()
    WHERE github_repo = ? AND workspace_id = ?
  `).run(repo, workspaceId)

  return NextResponse.json({ ok: true, repo })
}

export async function handleSyncProject(
  body: { project_id?: number },
  actor: string,
  workspaceId: number
): Promise<NextResponse> {
  if (typeof body.project_id !== 'number') {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getDatabase()
  const project = db.prepare(`
    SELECT id, github_repo, github_sync_enabled, github_default_branch
    FROM projects
    WHERE id = ? AND workspace_id = ? AND status = 'active'
  `).get(body.project_id, workspaceId) as ProjectSyncRow | undefined

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  if (!project.github_repo || !project.github_sync_enabled) {
    return NextResponse.json({ error: 'GitHub sync not enabled for this project' }, { status: 400 })
  }

  const result = await pullFromGitHub(project, workspaceId)

  db_helpers.logActivity(
    'github_sync', 'project', project.id, actor,
    `Manual sync: pulled ${result.pulled}, pushed ${result.pushed}`,
    { repo: project.github_repo, ...result },
    workspaceId
  )

  return NextResponse.json({ ok: true, ...result })
}

export function mapPriority(labels: string[]): 'critical' | 'high' | 'medium' | 'low' {
  for (const label of labels) {
    const lower = label.toLowerCase()
    if (lower === 'priority:critical' || lower === 'critical') return 'critical'
    if (lower === 'priority:high' || lower === 'high') return 'high'
    if (lower === 'priority:low' || lower === 'low') return 'low'
    if (lower === 'priority:medium') return 'medium'
  }
  return 'medium'
}
