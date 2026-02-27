import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';

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
  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const agentId = resolvedParams.id;
    
    // Get agent by ID or name
    let agent: any;
    if (isNaN(Number(agentId))) {
      // Lookup by name
      agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(agentId);
    } else {
      // Lookup by ID
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(agentId));
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
      AND c.created_at > ?
      ORDER BY c.created_at DESC
      LIMIT 10
    `).all(`%"${agent.name}"%`, fourHoursAgo);
    
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
    
    // 2. Check for assigned tasks
    const assignedTasks = db.prepare(`
      SELECT * FROM tasks 
      WHERE assigned_to = ?
      AND status IN ('assigned', 'in_progress')
      ORDER BY priority DESC, created_at ASC
      LIMIT 10
    `).all(agent.name);
    
    if (assignedTasks.length > 0) {
      workItems.push({
        type: 'assigned_tasks',
        count: assignedTasks.length,
        items: assignedTasks.map((t: any) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          due_date: t.due_date
        }))
      });
    }
    
    // 3. Check for unread notifications
    const notifications = db_helpers.getUnreadNotifications(agent.name);
    
    if (notifications.length > 0) {
      workItems.push({
        type: 'notifications',
        count: notifications.length,
        items: notifications.slice(0, 5).map(n => ({
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          created_at: n.created_at
        }))
      });
    }
    
    // 4. Check for urgent activities that might need attention
    const urgentActivities = db.prepare(`
      SELECT * FROM activities 
      WHERE type IN ('task_created', 'task_assigned', 'high_priority_alert')
      AND created_at > ?
      AND description LIKE ?
      ORDER BY created_at DESC
      LIMIT 5
    `).all(fourHoursAgo, `%${agent.name}%`);
    
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
    db_helpers.updateAgentStatus(agent.name, 'idle', 'Heartbeat check');
    
    // Log heartbeat activity
    db_helpers.logActivity(
      'agent_heartbeat',
      'agent',
      agent.id,
      agent.name,
      `Heartbeat check completed - ${workItems.length > 0 ? `${workItems.length} work items found` : 'no work items'}`,
      { workItemsCount: workItems.length, workItemTypes: workItems.map(w => w.type) }
    );
    
    if (workItems.length === 0) {
      return NextResponse.json({
        status: 'HEARTBEAT_OK',
        agent: agent.name,
        checked_at: now,
        message: 'No work items found'
      });
    }
    
    return NextResponse.json({
      status: 'WORK_ITEMS_FOUND',
      agent: agent.name,
      checked_at: now,
      work_items: workItems,
      total_items: workItems.reduce((sum, item) => sum + item.count, 0)
    });
    
  } catch (error) {
    console.error('GET /api/agents/[id]/heartbeat error:', error);
    return NextResponse.json({ error: 'Failed to perform heartbeat check' }, { status: 500 });
  }
}

/**
 * POST /api/agents/[id]/heartbeat - Manual heartbeat trigger
 * Allows manual heartbeat checks from UI or scripts
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Reuse GET logic for manual triggers
  return GET(request, { params });
}