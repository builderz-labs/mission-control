import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, Activity } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * GET /api/activities - Get activity stream or stats
 * Query params: type, actor, entity_type, limit, offset, since, hours (for stats)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams, pathname } = new URL(request.url);
    const workspaceId = auth.user.workspace_id ?? 1;
    
    // Route to stats endpoint if requested
    if (pathname.endsWith('/stats') || searchParams.has('stats')) {
      return handleStatsRequest(request, workspaceId);
    }
    
    // Default activities endpoint
    return handleActivitiesRequest(request, workspaceId);
  } catch (error) {
    logger.error({ err: error }, 'GET /api/activities error');
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}

/**
 * Handle regular activities request
 */
async function handleActivitiesRequest(request: NextRequest, workspaceId: number) {
  try {
    const db = getDatabase();
    const { searchParams } = new URL(request.url);
    
    // Parse query parameters
    const type = searchParams.get('type');
    const actor = searchParams.get('actor');
    const entity_type = searchParams.get('entity_type');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');
    const since = searchParams.get('since'); // Unix timestamp for real-time updates
    
    // Build dynamic query
    let query = 'SELECT * FROM activities WHERE workspace_id = ?';
    const params: any[] = [workspaceId];
    
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    
    if (actor) {
      query += ' AND actor = ?';
      params.push(actor);
    }
    
    if (entity_type) {
      query += ' AND entity_type = ?';
      params.push(entity_type);
    }
    
    if (since) {
      query += ' AND created_at > ?';
      params.push(parseInt(since));
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const stmt = db.prepare(query);
    const activities = stmt.all(...params) as Activity[];
    
    // Prepare entity detail statements once (avoids N+1)
    const taskDetailStmt = db.prepare('SELECT id, title, status FROM tasks WHERE id = ? AND workspace_id = ?');
    const agentDetailStmt = db.prepare('SELECT id, name, role, status FROM agents WHERE id = ? AND workspace_id = ?');
    const commentDetailStmt = db.prepare(`
      SELECT c.id, c.content, c.task_id, t.title as task_title
      FROM comments c
      LEFT JOIN tasks t ON c.task_id = t.id
      WHERE c.id = ? AND c.workspace_id = ? AND t.workspace_id = ?
    `);

    // Parse JSON data field and enhance with related entity data
    const enhancedActivities = activities.map(activity => {
      let entityDetails = null;

      try {
        switch (activity.entity_type) {
          case 'task': {
            const task = taskDetailStmt.get(activity.entity_id, workspaceId) as any;
            if (task) {
              entityDetails = { type: 'task', ...task };
            }
            break;
          }
          case 'agent': {
            const agent = agentDetailStmt.get(activity.entity_id, workspaceId) as any;
            if (agent) {
              entityDetails = { type: 'agent', ...agent };
            }
            break;
          }
          case 'comment': {
            const comment = commentDetailStmt.get(activity.entity_id, workspaceId, workspaceId) as any;
            if (comment) {
              entityDetails = {
                type: 'comment',
                ...comment,
                content_preview: comment.content?.substring(0, 100) || ''
              };
            }
            break;
          }
        }
      } catch (error) {
        logger.warn({ err: error, activityId: activity.id }, 'Failed to fetch entity details for activity');
      }

      return {
        ...activity,
        data: activity.data ? JSON.parse(activity.data) : null,
        entity: entityDetails
      };
    });
    
    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM activities WHERE workspace_id = ?';
    const countParams: any[] = [workspaceId];
    
    if (type) {
      countQuery += ' AND type = ?';
      countParams.push(type);
    }
    
    if (actor) {
      countQuery += ' AND actor = ?';
      countParams.push(actor);
    }
    
    if (entity_type) {
      countQuery += ' AND entity_type = ?';
      countParams.push(entity_type);
    }
    
    if (since) {
      countQuery += ' AND created_at > ?';
      countParams.push(parseInt(since));
    }
    
    const countResult = db.prepare(countQuery).get(...countParams) as { total: number };
    
    return NextResponse.json({ 
      activities: enhancedActivities,
      total: countResult.total,
      hasMore: offset + activities.length < countResult.total
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/activities (activities) error');
    return NextResponse.json({ error: 'Failed to fetch activities' }, { status: 500 });
  }
}

/**
 * Handle stats request
 */
async function handleStatsRequest(request: NextRequest, workspaceId: number) {
  try {
    const db = getDatabase();
    const { searchParams } = new URL(request.url);
    
    // Parse timeframe parameter (defaults to 24 hours)
    const hours = parseInt(searchParams.get('hours') || '24');
    const since = Math.floor(Date.now() / 1000) - (hours * 3600);
    
    // Get activity counts by type
    const activityStats = db.prepare(`
      SELECT 
        type,
        COUNT(*) as count
      FROM activities 
      WHERE created_at > ? AND workspace_id = ?
      GROUP BY type
      ORDER BY count DESC
    `).all(since, workspaceId) as { type: string; count: number }[];
    
    // Get most active actors
    const activeActors = db.prepare(`
      SELECT 
        actor,
        COUNT(*) as activity_count
      FROM activities 
      WHERE created_at > ? AND workspace_id = ?
      GROUP BY actor
      ORDER BY activity_count DESC
      LIMIT 10
    `).all(since, workspaceId) as { actor: string; activity_count: number }[];
    
    // Get activity timeline (hourly buckets)
    const timeline = db.prepare(`
      SELECT 
        (created_at / 3600) * 3600 as hour_bucket,
        COUNT(*) as count
      FROM activities 
      WHERE created_at > ? AND workspace_id = ?
      GROUP BY hour_bucket
      ORDER BY hour_bucket ASC
    `).all(since, workspaceId) as { hour_bucket: number; count: number }[];
    
    return NextResponse.json({
      timeframe: `${hours} hours`,
      activityByType: activityStats,
      topActors: activeActors,
      timeline: timeline.map(item => ({
        timestamp: item.hour_bucket,
        count: item.count,
        hour: new Date(item.hour_bucket * 1000).toISOString()
      }))
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/activities (stats) error');
    return NextResponse.json({ error: 'Failed to fetch activity stats' }, { status: 500 });
  }
}
