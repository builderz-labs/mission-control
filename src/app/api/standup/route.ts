import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * POST /api/standup/generate - Generate daily standup report
 * Body: { date?: string, agents?: string[] }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const body = await request.json();
    const workspaceId = auth.user.workspace_id ?? 1;
    
    // Parse parameters
    const targetDate = body.date || new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const specificAgents = body.agents; // Optional filter for specific agents
    
    // Calculate time range for "today" (start and end of the target date)
    const startOfDay = Math.floor(new Date(`${targetDate}T00:00:00Z`).getTime() / 1000);
    const endOfDay = Math.floor(new Date(`${targetDate}T23:59:59Z`).getTime() / 1000);
    
    // Get all active agents or filter by specific agents
    let agentQuery = 'SELECT * FROM agents WHERE workspace_id = ?';
    const agentParams: any[] = [workspaceId];
    
    if (specificAgents && Array.isArray(specificAgents) && specificAgents.length > 0) {
      const placeholders = specificAgents.map(() => '?').join(',');
      agentQuery += ` AND name IN (${placeholders})`;
      agentParams.push(...specificAgents);
    }
    
    agentQuery += ' ORDER BY name';
    
    const agents = db.prepare(agentQuery).all(...agentParams) as any[];
    
    // Prepare statements once (avoids N+1 per agent)
    const completedTasksStmt = db.prepare(`
      SELECT id, title, status, updated_at
      FROM tasks
      WHERE assigned_to = ?
      AND workspace_id = ?
      AND status = 'done'
      AND updated_at BETWEEN ? AND ?
      ORDER BY updated_at DESC
    `);
    const inProgressTasksStmt = db.prepare(`
      SELECT id, title, status, created_at, due_date
      FROM tasks
      WHERE assigned_to = ?
      AND workspace_id = ?
      AND status = 'in_progress'
      ORDER BY created_at ASC
    `);
    const assignedTasksStmt = db.prepare(`
      SELECT id, title, status, created_at, due_date, priority
      FROM tasks
      WHERE assigned_to = ?
      AND workspace_id = ?
      AND status = 'assigned'
      ORDER BY priority DESC, created_at ASC
    `);
    const reviewTasksStmt = db.prepare(`
      SELECT id, title, status, updated_at
      FROM tasks
      WHERE assigned_to = ?
      AND workspace_id = ?
      AND status IN ('review', 'quality_review')
      ORDER BY updated_at ASC
    `);
    const blockedTasksStmt = db.prepare(`
      SELECT id, title, status, priority, created_at, metadata
      FROM tasks
      WHERE assigned_to = ?
      AND workspace_id = ?
      AND (priority = 'urgent' OR metadata LIKE '%blocked%')
      AND status NOT IN ('done')
      ORDER BY priority DESC, created_at ASC
    `);
    const activityCountStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM activities
      WHERE actor = ?
      AND workspace_id = ?
      AND created_at BETWEEN ? AND ?
    `);
    const commentCountStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM comments
      WHERE author = ?
      AND workspace_id = ?
      AND created_at BETWEEN ? AND ?
    `);

    // Generate standup data for each agent
    const standupData = agents.map(agent => {
      const completedTasks = completedTasksStmt.all(agent.name, workspaceId, startOfDay, endOfDay);
      const inProgressTasks = inProgressTasksStmt.all(agent.name, workspaceId);
      const assignedTasks = assignedTasksStmt.all(agent.name, workspaceId);
      const reviewTasks = reviewTasksStmt.all(agent.name, workspaceId);
      const blockedTasks = blockedTasksStmt.all(agent.name, workspaceId);
      const activityCount = activityCountStmt.get(agent.name, workspaceId, startOfDay, endOfDay) as { count: number };
      const commentsToday = commentCountStmt.get(agent.name, workspaceId, startOfDay, endOfDay) as { count: number };

      return {
        agent: {
          name: agent.name,
          role: agent.role,
          status: agent.status,
          last_seen: agent.last_seen,
          last_activity: agent.last_activity
        },
        completedToday: completedTasks,
        inProgress: inProgressTasks,
        assigned: assignedTasks,
        review: reviewTasks,
        blocked: blockedTasks,
        activity: {
          actionCount: activityCount.count,
          commentsCount: commentsToday.count
        }
      };
    });
    
    // Generate summary statistics
    const totalCompleted = standupData.reduce((sum, agent) => sum + agent.completedToday.length, 0);
    const totalInProgress = standupData.reduce((sum, agent) => sum + agent.inProgress.length, 0);
    const totalAssigned = standupData.reduce((sum, agent) => sum + agent.assigned.length, 0);
    const totalReview = standupData.reduce((sum, agent) => sum + agent.review.length, 0);
    const totalBlocked = standupData.reduce((sum, agent) => sum + agent.blocked.length, 0);
    const totalActivity = standupData.reduce((sum, agent) => sum + agent.activity.actionCount, 0);
    
    // Identify team accomplishments and blockers
    const teamAccomplishments = standupData
      .flatMap(agent => agent.completedToday.map(task => ({ ...task as any, agent: agent.agent.name })))
      .sort((a: any, b: any) => b.updated_at - a.updated_at);
    
    const teamBlockers = standupData
      .flatMap(agent => agent.blocked.map(task => ({ ...task as any, agent: agent.agent.name })))
      .sort((a: any, b: any) => {
        // Sort by priority then by creation date
        const priorityOrder: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
        return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0) || a.created_at - b.created_at;
      });
    
    // Get overdue tasks across all agents
    const now = Math.floor(Date.now() / 1000);
    const overdueTasks = db.prepare(`
      SELECT t.*, a.name as agent_name
      FROM tasks t
      LEFT JOIN agents a ON t.assigned_to = a.name
      AND a.workspace_id = t.workspace_id
      WHERE t.due_date < ? 
      AND t.workspace_id = ?
      AND t.status NOT IN ('done')
      ORDER BY t.due_date ASC
    `).all(now, workspaceId);
    
    const standupReport = {
      date: targetDate,
      generatedAt: new Date().toISOString(),
      summary: {
        totalAgents: agents.length,
        totalCompleted,
        totalInProgress,
        totalAssigned,
        totalReview,
        totalBlocked,
        totalActivity,
        overdue: overdueTasks.length
      },
      agentReports: standupData,
      teamAccomplishments: teamAccomplishments.slice(0, 10), // Top 10 recent completions
      teamBlockers,
      overdueTasks
    };

    // Persist standup report
    const createdAt = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT OR REPLACE INTO standup_reports (date, report, created_at, workspace_id)
      VALUES (?, ?, ?, ?)
    `).run(targetDate, JSON.stringify(standupReport), createdAt, workspaceId);
    
    // Log the standup generation
    db_helpers.logActivity(
      'standup_generated',
      'standup',
      0, // No specific entity
      auth.user.username,
      `Generated daily standup for ${targetDate}`,
      {
        date: targetDate,
        agentCount: agents.length,
        tasksSummary: {
          completed: totalCompleted,
          inProgress: totalInProgress,
          assigned: totalAssigned,
          review: totalReview,
          blocked: totalBlocked
        }
      },
      workspaceId
    );
    
    return NextResponse.json({ standup: standupReport });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/standup/generate error');
    return NextResponse.json({ error: 'Failed to generate standup' }, { status: 500 });
  }
}

/**
 * GET /api/standup/history - Get previous standup reports
 * Query params: limit, offset
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const { searchParams } = new URL(request.url);
    const workspaceId = auth.user.workspace_id ?? 1;

    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    
    const standupRows = db.prepare(`
      SELECT date, report, created_at
      FROM standup_reports
      WHERE workspace_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(workspaceId, limit, offset) as Array<{ date: string; report: string; created_at: number }>;

    const standupHistory = standupRows.map((row, index) => {
      const report = row.report ? JSON.parse(row.report) : {};
      return {
        id: `${row.date}-${index}`,
        date: row.date || report.date || 'Unknown',
        generatedAt: report.generatedAt || new Date(row.created_at * 1000).toISOString(),
        summary: report.summary || {},
        agentCount: report.summary?.totalAgents || 0
      };
    });
    
    const countRow = db
      .prepare('SELECT COUNT(*) as total FROM standup_reports WHERE workspace_id = ?')
      .get(workspaceId) as { total: number };

    return NextResponse.json({
      history: standupHistory,
      total: countRow.total,
      page: Math.floor(offset / limit) + 1,
      limit
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/standup/history error');
    return NextResponse.json({ error: 'Failed to fetch standup history' }, { status: 500 });
  }
}
