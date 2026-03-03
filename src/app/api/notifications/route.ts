import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, Notification } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { validateBody, notificationActionSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';

/**
 * GET /api/notifications - Get notifications for a specific recipient
 * Query params: recipient, unread_only, type, limit, offset
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase();
    const { searchParams } = new URL(request.url);
    const workspaceId = auth.user.workspace_id ?? 1;
    
    // Parse query parameters
    const recipient = searchParams.get('recipient');
    const unread_only = searchParams.get('unread_only') === 'true';
    const type = searchParams.get('type');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');
    
    if (!recipient) {
      return NextResponse.json({ error: 'Recipient is required' }, { status: 400 });
    }
    
    // Build dynamic query
    let query = 'SELECT * FROM notifications WHERE recipient = ? AND workspace_id = ?';
    const params: any[] = [recipient, workspaceId];
    
    if (unread_only) {
      query += ' AND read_at IS NULL';
    }
    
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const stmt = db.prepare(query);
    const notifications = stmt.all(...params) as Notification[];
    
    // Prepare source detail statements once (avoids N+1)
    const taskDetailStmt = db.prepare('SELECT id, title, status FROM tasks WHERE id = ? AND workspace_id = ?');
    const commentDetailStmt = db.prepare(`
      SELECT c.id, c.content, c.task_id, t.title as task_title
      FROM comments c
      LEFT JOIN tasks t ON c.task_id = t.id
      WHERE c.id = ? AND c.workspace_id = ? AND t.workspace_id = ?
    `);
    const agentDetailStmt = db.prepare('SELECT id, name, role, status FROM agents WHERE id = ? AND workspace_id = ?');

    // Enhance notifications with related entity data
    const enhancedNotifications = notifications.map(notification => {
      let sourceDetails = null;

      try {
        if (notification.source_type && notification.source_id) {
          switch (notification.source_type) {
            case 'task': {
              const task = taskDetailStmt.get(notification.source_id, workspaceId) as any;
              if (task) {
                sourceDetails = { type: 'task', ...task };
              }
              break;
            }
            case 'comment': {
              const comment = commentDetailStmt.get(notification.source_id, workspaceId, workspaceId) as any;
              if (comment) {
                sourceDetails = {
                  type: 'comment',
                  ...comment,
                  content_preview: comment.content?.substring(0, 100) || ''
                };
              }
              break;
            }
            case 'agent': {
              const agent = agentDetailStmt.get(notification.source_id, workspaceId) as any;
              if (agent) {
                sourceDetails = { type: 'agent', ...agent };
              }
              break;
            }
          }
        }
      } catch (error) {
        logger.warn({ err: error, notificationId: notification.id }, 'Failed to fetch source details for notification');
      }

      return {
        ...notification,
        source: sourceDetails
      };
    });
    
    // Get unread count for this recipient
    const unreadCount = db.prepare(`
      SELECT COUNT(*) as count 
      FROM notifications 
      WHERE recipient = ? AND read_at IS NULL AND workspace_id = ?
    `).get(recipient, workspaceId) as { count: number };
    
    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM notifications WHERE recipient = ? AND workspace_id = ?';
    const countParams: any[] = [recipient, workspaceId];
    if (unread_only) {
      countQuery += ' AND read_at IS NULL';
    }
    if (type) {
      countQuery += ' AND type = ?';
      countParams.push(type);
    }
    const countRow = db.prepare(countQuery).get(...countParams) as { total: number };

    return NextResponse.json({
      notifications: enhancedNotifications,
      total: countRow.total,
      page: Math.floor(offset / limit) + 1,
      limit,
      unreadCount: unreadCount.count
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/notifications error');
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}

/**
 * PUT /api/notifications - Mark notifications as read
 * Body: { ids: number[] } or { recipient: string } (mark all as read)
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id ?? 1;
    const body = await request.json();
    const { ids, recipient, markAllRead } = body;
    
    const now = Math.floor(Date.now() / 1000);
    
    if (markAllRead && recipient) {
      // Mark all notifications as read for this recipient
      const stmt = db.prepare(`
        UPDATE notifications 
        SET read_at = ?
        WHERE recipient = ? AND read_at IS NULL AND workspace_id = ?
      `);
      
      const result = stmt.run(now, recipient, workspaceId);
      
      return NextResponse.json({ 
        success: true, 
        markedAsRead: result.changes 
      });
    } else if (ids && Array.isArray(ids)) {
      // Mark specific notifications as read
      const placeholders = ids.map(() => '?').join(',');
      const stmt = db.prepare(`
        UPDATE notifications 
        SET read_at = ?
        WHERE id IN (${placeholders}) AND read_at IS NULL AND workspace_id = ?
      `);
      
      const result = stmt.run(now, ...ids, workspaceId);
      
      return NextResponse.json({ 
        success: true, 
        markedAsRead: result.changes 
      });
    } else {
      return NextResponse.json({ 
        error: 'Either provide ids array or recipient with markAllRead=true' 
      }, { status: 400 });
    }
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/notifications error');
    return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 });
  }
}

/**
 * DELETE /api/notifications - Delete notifications
 * Body: { ids: number[] } or { recipient: string, olderThan: number }
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id ?? 1;
    const body = await request.json();
    const { ids, recipient, olderThan } = body;
    
    if (ids && Array.isArray(ids)) {
      // Delete specific notifications
      const placeholders = ids.map(() => '?').join(',');
      const stmt = db.prepare(`
        DELETE FROM notifications 
        WHERE id IN (${placeholders}) AND workspace_id = ?
      `);
      
      const result = stmt.run(...ids, workspaceId);
      
      return NextResponse.json({ 
        success: true, 
        deleted: result.changes 
      });
    } else if (recipient && olderThan) {
      // Delete old notifications for recipient
      const stmt = db.prepare(`
        DELETE FROM notifications 
        WHERE recipient = ? AND created_at < ? AND workspace_id = ?
      `);
      
      const result = stmt.run(recipient, olderThan, workspaceId);
      
      return NextResponse.json({ 
        success: true, 
        deleted: result.changes 
      });
    } else {
      return NextResponse.json({ 
        error: 'Either provide ids array or recipient with olderThan timestamp' 
      }, { status: 400 });
    }
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/notifications error');
    return NextResponse.json({ error: 'Failed to delete notifications' }, { status: 500 });
  }
}

/**
 * POST /api/notifications/mark-delivered - Mark notifications as delivered to agent
 * Body: { agent: string }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const db = getDatabase();
    const workspaceId = auth.user.workspace_id ?? 1;

    const result = await validateBody(request, notificationActionSchema);
    if ('error' in result) return result.error;
    const { agent, action } = result.data;

    if (action === 'mark-delivered') {
      
      const now = Math.floor(Date.now() / 1000);
      
      // Mark undelivered notifications as delivered
      const stmt = db.prepare(`
        UPDATE notifications 
        SET delivered_at = ?
        WHERE recipient = ? AND delivered_at IS NULL AND workspace_id = ?
      `);
      
      const result = stmt.run(now, agent, workspaceId);
      
      // Get the notifications that were just marked as delivered
      const deliveredNotifications = db.prepare(`
        SELECT * FROM notifications 
        WHERE recipient = ? AND delivered_at = ? AND workspace_id = ?
        ORDER BY created_at DESC
      `).all(agent, now, workspaceId) as Notification[];
      
      return NextResponse.json({ 
        success: true, 
        delivered: result.changes,
        notifications: deliveredNotifications
      });
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    logger.error({ err: error }, 'POST /api/notifications error');
    return NextResponse.json({ error: 'Failed to process notification action' }, { status: 500 });
  }
}
