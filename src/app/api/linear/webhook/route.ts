import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { logger } from '@/lib/logger'
import { linearStateTypeToStatus, linearToPriority } from '@/lib/linear-map'
import crypto from 'crypto'

function getLinearWebhookSecret(): string | null {
  return process.env.LINEAR_WEBHOOK_SECRET || null
}

function verifyWebhookSignature(payload: string, signature: string | null): boolean {
  const secret = getLinearWebhookSecret()
  if (!secret || !signature) return false

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  )
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('linear-signature')

  if (!verifyWebhookSignature(body, signature)) {
    logger.warn({ signature }, 'Linear webhook signature verification failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const parsed = JSON.parse(body)
  const { type, data } = parsed

  logger.info({ type, issueId: data?.id }, 'Linear webhook received')

  const db = getDatabase()

  try {
    switch (type) {
      case 'Issue.create':
      case 'Issue.update':
        await handleIssueChange(data, db)
        break

      case 'Issue.delete':
        await handleIssueDelete(data, db)
        break

      case 'Comment.create':
        await handleCommentCreate(data, db)
        break

      default:
        logger.info({ type }, 'Unhandled Linear webhook type')
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    logger.error({ err: error, type }, 'Linear webhook handler error')
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}

async function handleIssueChange(issue: any, db: any) {
  const existingTask = db.prepare(`
    SELECT id, workspace_id FROM tasks WHERE linear_issue_id = ?
  `).get(issue.id) as any

  const status = linearStateTypeToStatus(issue.state?.type, issue.state?.name)
  const priority = linearToPriority(issue.priority)

  if (existingTask) {
    db.prepare(`
      UPDATE tasks
      SET title = ?, description = ?, status = ?, priority = ?, updated_at = unixepoch()
      WHERE id = ?
    `).run(issue.title, issue.description, status, priority, existingTask.id)

    logger.info({ taskId: existingTask.id, issueId: issue.id }, 'Updated task from Linear webhook')
  } else {
    const project = db.prepare(`
      SELECT id, workspace_id FROM projects WHERE linear_team_id = ?
    `).get(issue.teamId) as any

    if (project) {
      const now = Math.floor(Date.now() / 1000)
      const labelNames = (issue.labels?.nodes || []).map((l: any) => l.name)

      db.prepare(`
        INSERT INTO tasks (
          title, description, status, priority, created_by,
          created_at, updated_at, tags, metadata,
          linear_issue_id, linear_team_id, linear_synced_at,
          project_id, workspace_id
        ) VALUES (?, ?, ?, ?, 'linear-webhook', ?, ?, ?, '{}', ?, ?, ?, ?, ?)
      `).run(
        issue.title,
        issue.description || '',
        status,
        priority,
        now, now,
        JSON.stringify(labelNames),
        issue.id, issue.teamId, now,
        project.id, project.workspace_id
      )

      logger.info({ issueId: issue.id }, 'Created task from Linear webhook')
    }
  }
}

async function handleIssueDelete(issue: any, db: any) {
  const existingTask = db.prepare(`
    SELECT id FROM tasks WHERE linear_issue_id = ?
  `).get(issue.id) as any

  if (existingTask) {
    // Mark as done (soft delete / archive)
    db.prepare(`
      UPDATE tasks SET status = 'done', updated_at = unixepoch()
      WHERE id = ?
    `).run(existingTask.id)

    logger.info({ taskId: existingTask.id, issueId: issue.id }, 'Handled Linear issue deletion')
  }
}

async function handleCommentCreate(comment: any, db: any) {
  const task = db.prepare(`
    SELECT id, workspace_id FROM tasks WHERE linear_issue_id = ?
  `).get(comment.issueId) as any

  if (task) {
    const now = Math.floor(Date.now() / 1000)
    const author = comment.user?.name || 'linear-user'

    db.prepare(`
      INSERT INTO comments (task_id, author, content, created_at, workspace_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(task.id, author, comment.body, now, task.workspace_id)

    logger.info({ taskId: task.id }, 'Created comment from Linear webhook')
  }
}
