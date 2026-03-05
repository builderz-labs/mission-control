import { NextRequest, NextResponse } from 'next/server';
import { db_helpers } from '@/lib/db';
import { eventBus } from '@/lib/event-bus';
import { getUserFromRequest, requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  getIssue,
  getProject,
  mapIssueToTask,
  getCCDatabaseWrite,
  PRIORITY_FROM_MC,
  type IssueStatus,
} from '@/lib/cc-db';

const VALID_STATUSES: Set<string> = new Set(['open', 'in_progress', 'review', 'blocked', 'done']);

function isHumanUser(request: NextRequest): boolean {
  const username = request.headers.get('x-mc-actor') || '';
  if (username.toLowerCase() === 'cri') return true;
  const apiKey = request.headers.get('x-api-key');
  if (apiKey) return true;
  const cookie = request.headers.get('cookie') || '';
  if (cookie.includes('mc-session')) return true;
  return false;
}

/**
 * GET /api/tasks/[id] - Get a specific issue from control-center.db
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const resolvedParams = await params;
    const issueId = resolvedParams.id;

    const issue = getIssue(issueId);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const projectTitle = issue.project_id ? getProject(issue.project_id)?.title : undefined;
    const task = mapIssueToTask(issue, projectTitle);

    return NextResponse.json({ task });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/[id] error');
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
  }
}

/**
 * PUT /api/tasks/[id] - Update an issue in control-center.db
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const resolvedParams = await params;
    const issueId = resolvedParams.id;
    const body = await request.json();

    const currentIssue = getIssue(issueId);
    if (!currentIssue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const {
      title,
      description,
      status,
      priority,
      assigned_to,
      creator,
      project_id,
    } = body;

    // Permission: agents cannot set done
    if (status === 'done' && !isHumanUser(request)) {
      return NextResponse.json({ error: 'Only human users can set status to done' }, { status: 403 });
    }

    if (status && !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }

    const now = new Date().toISOString();

    // Build dynamic update
    const fieldsToUpdate: string[] = [];
    const updateParams: any[] = [];

    if (title !== undefined) {
      fieldsToUpdate.push('title = ?');
      updateParams.push(title);
    }
    if (description !== undefined) {
      fieldsToUpdate.push('description = ?');
      updateParams.push(description);
    }
    if (status !== undefined) {
      fieldsToUpdate.push('status = ?');
      updateParams.push(status);
    }
    if (priority !== undefined) {
      fieldsToUpdate.push('priority = ?');
      updateParams.push(PRIORITY_FROM_MC[priority] || priority);
    }
    if (assigned_to !== undefined) {
      fieldsToUpdate.push('assignee = ?');
      updateParams.push(assigned_to);
    }
    if (creator !== undefined) {
      fieldsToUpdate.push('creator = ?');
      updateParams.push(creator);
    }
    if (project_id !== undefined) {
      fieldsToUpdate.push('project_id = ?');
      updateParams.push(project_id || null);
    }

    if (fieldsToUpdate.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    fieldsToUpdate.push('updated_at = ?');
    updateParams.push(now);
    updateParams.push(issueId);

    const writeDb = getCCDatabaseWrite();
    try {
      writeDb.prepare(`UPDATE issues SET ${fieldsToUpdate.join(', ')} WHERE id = ?`).run(...updateParams);
    } finally {
      writeDb.close();
    }

    // Track changes for activity log
    const changes: string[] = [];
    if (status && status !== currentIssue.status) {
      changes.push(`status: ${currentIssue.status} -> ${status}`);
    }
    if (assigned_to !== undefined && assigned_to !== currentIssue.assignee) {
      changes.push(`assigned: ${currentIssue.assignee || 'unassigned'} -> ${assigned_to || 'unassigned'}`);
    }
    if (title && title !== currentIssue.title) {
      changes.push('title updated');
    }
    if (priority) {
      const ccOldPriority = currentIssue.priority;
      const ccNewPriority = PRIORITY_FROM_MC[priority] || priority;
      if (ccNewPriority !== ccOldPriority) {
        changes.push(`priority: ${ccOldPriority} -> ${ccNewPriority}`);
      }
    }

    if (changes.length > 0) {
      db_helpers.logActivity(
        'task_updated',
        'task',
        0,
        getUserFromRequest(request)?.username || 'system',
        `Task updated: ${changes.join(', ')}`,
        { changes }
      );
    }

    // Re-fetch and return mapped task
    const updatedIssue = getIssue(issueId);
    if (!updatedIssue) {
      return NextResponse.json({ error: 'Task not found after update' }, { status: 500 });
    }

    const projectTitle = updatedIssue.project_id ? getProject(updatedIssue.project_id)?.title : undefined;
    const task = mapIssueToTask(updatedIssue, projectTitle);

    eventBus.broadcast('task.updated', task);

    return NextResponse.json({ task });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/tasks/[id] error');
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

/**
 * DELETE /api/tasks/[id] - Archive an issue in control-center.db (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const resolvedParams = await params;
    const issueId = resolvedParams.id;

    const issue = getIssue(issueId);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Soft-delete: set archived = 1
    const writeDb = getCCDatabaseWrite();
    try {
      writeDb.prepare('UPDATE issues SET archived = 1, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), issueId);
    } finally {
      writeDb.close();
    }

    db_helpers.logActivity(
      'task_deleted',
      'task',
      0,
      getUserFromRequest(request)?.username || 'system',
      `Archived task: ${issue.title}`,
      { title: issue.title, status: issue.status, assignee: issue.assignee }
    );

    eventBus.broadcast('task.deleted', { id: issueId, title: issue.title });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/tasks/[id] error');
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
