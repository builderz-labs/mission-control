import { NextRequest, NextResponse } from 'next/server';
import { db_helpers } from '@/lib/db';
import { eventBus } from '@/lib/event-bus';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  getIssues,
  getProject,
  mapIssueToTask,
  getCCDatabaseWrite,
  PRIORITY_FROM_MC,
  parseBlockedBy,
  getOpenBlockerIds,
  type IssueStatus,
  type KanbanColumn,
} from '@/lib/cc-db';
import { randomUUID } from 'crypto';

const VALID_STATUSES: Set<string> = new Set(['draft', 'open', 'closed']);

/**
 * GET /api/tasks - List all tasks from control-center.db issues table
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') || undefined;
    const assigned_to = searchParams.get('assigned_to') || undefined;
    const priority = searchParams.get('priority') || undefined;
    const column = (searchParams.get('column') || undefined) as KanbanColumn | undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');

    const { issues, total } = getIssues({ status, assigned_to, priority, column, limit, offset });

    // Build a project-title cache for the issues in this page
    const projectIds = [...new Set(issues.map(i => i.project_id).filter(Boolean))] as string[];
    const projectMap = new Map<string, string>();
    for (const pid of projectIds) {
      const p = getProject(pid);
      if (p) projectMap.set(pid, p.title);
    }

    const tasks = issues.map(issue =>
      mapIssueToTask(issue, issue.project_id ? projectMap.get(issue.project_id) : undefined)
    );

    // Batch-compute is_blocked for all tasks that have blockers
    const allBlockerIds = [...new Set(tasks.flatMap(t => t.blocked_by || []))];
    const openBlockers = getOpenBlockerIds(allBlockerIds);
    for (const task of tasks) {
      (task as any).is_blocked = (task.blocked_by || []).some((id: string) => openBlockers.has(id));
    }

    return NextResponse.json({
      tasks,
      total,
      page: Math.floor(offset / limit) + 1,
      limit,
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks error');
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

/**
 * POST /api/tasks - Create a new issue in control-center.db
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const body = await request.json();
    const user = auth.user;

    let {
      title,
      description = '',
      status = 'open',
      priority = 'medium',
      assigned_to = '',
      creator = user?.username || 'system',
      metadata = {},
    } = body;

    // If no title but has description, generate via AI
    if ((!title || typeof title !== 'string' || title.trim().length === 0) && description.trim().length > 0) {
      const { generateTaskLabel } = await import('@/lib/ai-label');
      const label = await generateTaskLabel(description);
      title = label.title;
      description = label.description;
    }

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'Title or description is required' }, { status: 400 });
    }

    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}. Valid: ${[...VALID_STATUSES].join(', ')}` }, { status: 400 });
    }

    const ccPriority = PRIORITY_FROM_MC[priority] || 'normal';
    const now = new Date().toISOString();
    const id = randomUUID();
    const projectId = metadata?.project_id || '';

    // Parse blocked_by if provided
    const blockedBy = Array.isArray(body.blocked_by) ? JSON.stringify(body.blocked_by) : '[]';

    const writeDb = getCCDatabaseWrite();
    try {
      writeDb.prepare(`
        INSERT INTO issues (id, project_id, title, description, status, assignee, creator, priority, created_at, updated_at, blocked_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, projectId || null, title, description, status as IssueStatus, assigned_to, creator, ccPriority, now, now, blockedBy);
    } finally {
      writeDb.close();
    }

    const projectTitle = projectId ? getProject(projectId)?.title : undefined;
    const task = mapIssueToTask(
      {
        id,
        project_id: projectId || null,
        title,
        description,
        status: status as IssueStatus,
        assignee: assigned_to,
        creator,
        priority: ccPriority as 'low' | 'normal' | 'high',
        created_at: now,
        updated_at: now,
        archived: 0,
        schedule: '',
        parent_id: null,
        notion_id: '',
        plan_path: null,
        last_turn_at: null,
        seen_at: null,
        picked: 0,
        picked_at: null,
        picked_by: '',
        blocked_by: '[]',
      },
      projectTitle,
    );

    db_helpers.logActivity('task_created', 'task', 0, creator, `Created task: ${title}`, {
      title, status, priority, assigned_to,
    });

    eventBus.broadcast('task.created', task);

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks error');
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}

/**
 * PUT /api/tasks - Bulk update issues in control-center.db (drag-and-drop)
 * Accepts: { tasks: [{ id, status?, assigned_to? }] }
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const { tasks } = await request.json();

    if (!Array.isArray(tasks)) {
      return NextResponse.json({ error: 'Tasks must be an array' }, { status: 400 });
    }

    for (const item of tasks) {
      if (item.status && !VALID_STATUSES.has(item.status)) {
        return NextResponse.json({ error: `Invalid status: ${item.status}` }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    const actor = auth.user.username;

    const writeDb = getCCDatabaseWrite();
    try {
      const updateStatusStmt = writeDb.prepare('UPDATE issues SET status = ?, updated_at = ? WHERE id = ?');
      const updateAssigneeStmt = writeDb.prepare('UPDATE issues SET assignee = ?, updated_at = ? WHERE id = ?');
      const updateBothStmt = writeDb.prepare('UPDATE issues SET status = ?, assignee = ?, updated_at = ? WHERE id = ?');

      const transaction = writeDb.transaction((items: Array<{ id: string; status?: string; assigned_to?: string }>) => {
        for (const item of items) {
          if (item.status && item.assigned_to !== undefined) {
            updateBothStmt.run(item.status, item.assigned_to, now, item.id);
          } else if (item.status) {
            updateStatusStmt.run(item.status, now, item.id);
          } else if (item.assigned_to !== undefined) {
            updateAssigneeStmt.run(item.assigned_to, now, item.id);
          }
        }
      });
      transaction(tasks);
    } finally {
      writeDb.close();
    }

    for (const task of tasks) {
      const changes: string[] = [];
      if (task.status) changes.push(`status → ${task.status}`);
      if (task.assigned_to !== undefined) changes.push(`assignee → ${task.assigned_to || 'unassigned'}`);

      eventBus.broadcast('task.updated', {
        id: task.id,
        status: task.status,
        assigned_to: task.assigned_to,
        updated_at: Math.floor(Date.now() / 1000),
      });
      db_helpers.logActivity('task_updated', 'task', 0, actor, `Task updated: ${changes.join(', ')}`, {
        changes,
      });
    }

    return NextResponse.json({ success: true, updated: tasks.length });
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/tasks error');
    return NextResponse.json({ error: 'Failed to update tasks' }, { status: 500 });
  }
}
