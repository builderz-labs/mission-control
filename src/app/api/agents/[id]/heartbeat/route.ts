import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { resolveTaskImplementationTarget } from '@/lib/task-routing';

/**
 * GET /api/agents/[id]/heartbeat - Agent heartbeat check
 * 
 * Checks for:
 * - @mentions in recent comments
 * - Assigned tasks
 * - Recent activity feed items
 * 
 * Returns work items or "HEARTBEAT_OK" if nothing to do
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const agentId = resolvedParams.id;
    const workspaceId = auth.user.workspace_id ?? 1;
    
    // Get agent by ID or name
    let agent: any;
    if (isNaN(Number(agentId))) {
      // Lookup by name
      agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId);
    } else {
      // Lookup by ID
      agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId);
    }
    
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    
    const workItems: any[] = [];
    const now = Math.floor(Date.now() / 1000);
    const fourHoursAgo = now - (4 * 60 * 60); // Check last 4 hours
    
    // 1. Check for @mentions in recent comments
    const mentions = db.prepare(`
      SELECT c.*, t.title as task_title 
      FROM comments c
      JOIN tasks t ON c.task_id = t.id
      WHERE c.mentions LIKE ?
      AND c.workspace_id = ?
      AND t.workspace_id = ?
      AND c.created_at > ?
      ORDER BY c.created_at DESC
      LIMIT 10
    `).all(`%"${agent.name}"%`, workspaceId, workspaceId, fourHoursAgo);
    
    if (mentions.length > 0) {
      workItems.push({
        type: 'mentions',
        count: mentions.length,
        items: mentions.map((m: any) => ({
          id: m.id,
          task_title: m.task_title,
          author: m.author,
          content: m.content.substring(0, 100) + '...',
          created_at: m.created_at
        }))
      });
    }
    
    // 2. Check for assigned tasks (split for explicit actionability contract)
    const assignedTasks = db.prepare(`
      SELECT * FROM tasks 
      WHERE assigned_to = ?
      AND workspace_id = ?
      AND status IN ('assigned', 'in_progress')
      ORDER BY priority DESC, created_at ASC
      LIMIT 20
    `).all(agent.name, workspaceId) as any[];

    const assignedOnly = assignedTasks.filter((t) => t.status === 'assigned');
    const inProgress = assignedTasks.filter((t) => t.status === 'in_progress');
    const mapTask = (t: any) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date,
      ...resolveTaskImplementationTarget(t)
    });

    if (assignedOnly.length > 0) {
      workItems.push({
        type: 'assigned_tasks',
        count: assignedOnly.length,
        items: assignedOnly.map(mapTask)
      });
    }

    if (inProgress.length > 0) {
      workItems.push({
        type: 'in_progress_tasks',
        count: inProgress.length,
        items: inProgress.map(mapTask)
      });
    }
    
    // 3. Check unread + undelivered notifications and enrich with task/comment IDs
    const pendingNotifications = db_helpers.getPendingHeartbeatNotifications(agent.name, workspaceId);

    const notificationItems = pendingNotifications.slice(0, 20).map((n: any) => {
      let task_id: number | null = null;
      let comment_id: number | null = null;

      if (n.source_type === 'task') {
        task_id = n.source_id;
      }

      if (n.source_type === 'comment') {
        comment_id = n.source_id;
        const commentRow = db.prepare('SELECT task_id FROM comments WHERE id = ? AND workspace_id = ?').get(n.source_id, workspaceId) as any;
        task_id = commentRow?.task_id ?? null;
      }

      return {
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        created_at: n.created_at,
        task_id,
        comment_id
      };
    });

    if (notificationItems.length > 0) {
      workItems.push({
        type: 'notifications',
        count: notificationItems.length,
        items: notificationItems
      });

      // Mark this batch as delivered to avoid replaying stale notifications in next heartbeat.
      db_helpers.markNotificationsDelivered(notificationItems.map((n: any) => n.id), workspaceId);
    }
    
    // 4. Check for urgent activities that might need attention
    const urgentActivities = db.prepare(`
      SELECT * FROM activities 
      WHERE type IN ('task_created', 'task_assigned', 'high_priority_alert')
      AND workspace_id = ?
      AND created_at > ?
      AND description LIKE ?
      ORDER BY created_at DESC
      LIMIT 5
    `).all(workspaceId, fourHoursAgo, `%${agent.name}%`);
    
    if (urgentActivities.length > 0) {
      workItems.push({
        type: 'urgent_activities',
        count: urgentActivities.length,
        items: urgentActivities.map((a: any) => ({
          id: a.id,
          type: a.type,
          description: a.description,
          created_at: a.created_at
        }))
      });
    }
    
    // Update agent last_seen and status to show heartbeat activity
    db_helpers.updateAgentStatus(agent.name, 'idle', 'Heartbeat check', workspaceId);
    
    // Log heartbeat activity
    db_helpers.logActivity(
      'agent_heartbeat',
      'agent',
      agent.id,
      agent.name,
      `Heartbeat check completed - ${workItems.length > 0 ? `${workItems.length} work items found` : 'no work items'}`,
      { workItemsCount: workItems.length, workItemTypes: workItems.map(w => w.type) },
      workspaceId
    );
    
    const assignedTasksItem = workItems.find((w) => w.type === 'assigned_tasks');
    const inProgressTasksItem = workItems.find((w) => w.type === 'in_progress_tasks');
    const hasActionableWork = Boolean(
      (assignedTasksItem?.count ?? 0) > 0 ||
      (inProgressTasksItem?.count ?? 0) > 0 ||
      workItems.some((w) => w.type === 'mentions' || w.type === 'notifications' || w.type === 'urgent_activities')
    );

    if (workItems.length === 0) {
      return NextResponse.json({
        status: 'HEARTBEAT_OK',
        agent: agent.name,
        checked_at: now,
        assigned_tasks: [],
        in_progress_tasks: [],
        has_actionable_work: false,
        message: 'No work items found'
      });
    }
    
    return NextResponse.json({
      status: 'WORK_ITEMS_FOUND',
      agent: agent.name,
      checked_at: now,
      assigned_tasks: assignedTasksItem?.items ?? [],
      in_progress_tasks: inProgressTasksItem?.items ?? [],
      has_actionable_work: hasActionableWork,
      work_items: workItems,
      total_items: workItems.reduce((sum, item) => sum + item.count, 0)
    });
    
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/[id]/heartbeat error');
    return NextResponse.json({ error: 'Failed to perform heartbeat check' }, { status: 500 });
  }
}

/**
 * POST /api/agents/[id]/heartbeat - Enhanced heartbeat
 *
 * Accepts optional body:
 * - connection_id: update direct_connections.last_heartbeat
 * - status: agent status override
 * - last_activity: activity description
 * - token_usage: { model, inputTokens, outputTokens } for inline token reporting
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    // No body is fine — fall through to standard heartbeat
  }

  const { connection_id, token_usage } = body;
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const workspaceId = auth.user.workspace_id ?? 1;

  // Update direct connection heartbeat if connection_id provided
  if (connection_id) {
    db.prepare('UPDATE direct_connections SET last_heartbeat = ?, updated_at = ? WHERE connection_id = ? AND status = ? AND workspace_id = ?')
      .run(now, now, connection_id, 'connected', workspaceId);
  }

  // Inline token reporting
  let tokenRecorded = false;
  if (token_usage && token_usage.model && token_usage.inputTokens != null && token_usage.outputTokens != null) {
    const resolvedParams = await params;
    const agentId = resolvedParams.id;
    let agent: any;
    if (isNaN(Number(agentId))) {
      agent = db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId);
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId);
    }

    if (agent) {
      const sessionId = `${agent.name}:cli`;
      db.prepare(
        `INSERT INTO token_usage (model, session_id, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(token_usage.model, sessionId, token_usage.inputTokens, token_usage.outputTokens, now);
      tokenRecorded = true;
    }
  }

  // Reuse GET logic for work-items check, then augment response
  const getResponse = await GET(request, { params });
  const getBody = await getResponse.json();

  return NextResponse.json({
    ...getBody,
    token_recorded: tokenRecorded,
  });
}
