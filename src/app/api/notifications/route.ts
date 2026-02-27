import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, Notification } from '@/lib/db';
import { requireRole } from '@/lib/auth';

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
    
    // Parse query parameters
    const recipient = searchParams.get('recipient');
    const unread_only = searchParams.get('unread_only') === 'true';
    const type = searchParams.get('type');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    
    if (!recipient) {
      return NextResponse.json({ error: 'Recipient is required' }, { status: 400 });
    }
    
    // Build dynamic query
    let query = 'SELECT * FROM notifications WHERE recipient = ?';
    const params: any[] = [recipient];
    
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
    const taskDetailStmt = db.prepare('SELECT id, title, status FROM tasks WHERE id = ?');
    const commentDetailStmt = db.prepare(`
      SELECT c.id, c.content, c.task_id, t.title as task_title
      FROM comments c
      LEFT JOIN tasks t ON c.task_id = t.id
      WHERE c.id = ?
    `);
    const agentDetailStmt = db.prepare('SELECT id, name, role, status FROM agents WHERE id = ?');

    // Enhance notifications with related entity data
    const enhancedNotifications = notifications.map(notification => {
      let sourceDetails = null;

      try {
        if (notification.source_type && notification.source_id) {
          switch (notification.source_type) {
            case 'task': {
              const task = taskDetailStmt.get(notification.source_id) as any;
              if (task) {
                sourceDetails = { type: 'task', ...task };
              }
              break;
            }
            case 'comment': {
              const comment = commentDetailStmt.get(notification.source_id) as any;
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
              const agent = agentDetailStmt.get(notification.source_id) as any;
              if (agent) {
                sourceDetails = { type: 'agent', ...agent };
              }
              break;
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch source details for notification ${notification.id}:`, error);
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
      WHERE recipient = ? AND read_at IS NULL
    `).get(recipient) as { count: number };
    
    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM notifications WHERE recipient = ?';
    const countParams: any[] = [recipient];
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
    console.error('GET /api/notifications error:', error);
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

  try {
    const db = getDatabase();
    const body = await request.json();
    const { ids, recipient, markAllRead } = body;
    
    const now = Math.floor(Date.now() / 1000);
    
    if (markAllRead && recipient) {
      // Mark all notifications as read for this recipient
      const stmt = db.prepare(`
        UPDATE notifications 
        SET read_at = ?
        WHERE recipient = ? AND read_at IS NULL
      `);
      
      const result = stmt.run(now, recipient);
      
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
        WHERE id IN (${placeholders}) AND read_at IS NULL
      `);
      
      const result = stmt.run(now, ...ids);
      
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
    console.error('PUT /api/notifications error:', error);
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

  try {
    const db = getDatabase();
    const body = await request.json();
    const { ids, recipient, olderThan } = body;
    
    if (ids && Array.isArray(ids)) {
      // Delete specific notifications
      const placeholders = ids.map(() => '?').join(',');
      const stmt = db.prepare(`
        DELETE FROM notifications 
        WHERE id IN (${placeholders})
      `);
      
      const result = stmt.run(...ids);
      
      return NextResponse.json({ 
        success: true, 
        deleted: result.changes 
      });
    } else if (recipient && olderThan) {
      // Delete old notifications for recipient
      const stmt = db.prepare(`
        DELETE FROM notifications 
        WHERE recipient = ? AND created_at < ?
      `);
      
      const result = stmt.run(recipient, olderThan);
      
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
    console.error('DELETE /api/notifications error:', error);
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

  try {
    const db = getDatabase();
    const body = await request.json();
    const { agent, action } = body;
    
    if (action === 'mark-delivered') {
      if (!agent) {
        return NextResponse.json({ error: 'Agent name is required' }, { status: 400 });
      }
      
      const now = Math.floor(Date.now() / 1000);
      
      // Mark undelivered notifications as delivered
      const stmt = db.prepare(`
        UPDATE notifications 
        SET delivered_at = ?
        WHERE recipient = ? AND delivered_at IS NULL
      `);
      
      const result = stmt.run(now, agent);
      
      // Get the notifications that were just marked as delivered
      const deliveredNotifications = db.prepare(`
        SELECT * FROM notifications 
        WHERE recipient = ? AND delivered_at = ?
        ORDER BY created_at DESC
      `).all(agent, now) as Notification[];
      
      return NextResponse.json({ 
        success: true, 
        delivered: result.changes,
        notifications: deliveredNotifications
      });
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('POST /api/notifications error:', error);
    return NextResponse.json({ error: 'Failed to process notification action' }, { status: 500 });
  }
}