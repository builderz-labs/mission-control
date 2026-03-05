import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, db_helpers } from '@/lib/db';
import { getCCDatabase } from '@/lib/cc-db';
import { requireRole } from '@/lib/auth';

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
    
    // Parse parameters
    const targetDate = body.date || new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const specificAgents = body.agents; // Optional filter for specific agents
    
    // Calculate time range for "today" — CC uses ISO strings, MC uses unix timestamps
    const startOfDayUnix = Math.floor(new Date(`${targetDate}T00:00:00Z`).getTime() / 1000);
    const endOfDayUnix = Math.floor(new Date(`${targetDate}T23:59:59Z`).getTime() / 1000);
    const startOfDayISO = new Date(`${targetDate}T00:00:00Z`).toISOString();
    const endOfDayISO = new Date(`${targetDate}T23:59:59Z`).toISOString();
    
    // Get all active agents or filter by specific agents
    let agentQuery = 'SELECT * FROM agents';
    const agentParams: any[] = [];
    
    if (specificAgents && Array.isArray(specificAgents) && specificAgents.length > 0) {
      const placeholders = specificAgents.map(() => '?').join(',');
      agentQuery += ` WHERE name IN (${placeholders})`;
      agentParams.push(...specificAgents);
    }
    
    agentQuery += ' ORDER BY name';
    
    const agents = db.prepare(agentQuery).all(...agentParams) as any[];
    
    // Query tasks from control-center.db
    const ccDb = getCCDatabase();
    const completedTasksStmt = ccDb.prepare(`
      SELECT id, title, status, updated_at
      FROM issues
      WHERE assignee = ? AND archived = 0
      AND status = 'done'
      AND updated_at BETWEEN ? AND ?
      ORDER BY updated_at DESC
    `);
    const inProgressTasksStmt = ccDb.prepare(`
      SELECT id, title, status, created_at
      FROM issues
      WHERE assignee = ? AND archived = 0
      AND status = 'in_progress'
      ORDER BY created_at ASC
    `);
    const assignedTasksStmt = ccDb.prepare(`
      SELECT id, title, status, created_at, priority
      FROM issues
      WHERE assignee = ? AND archived = 0
      AND status = 'open'
      ORDER BY priority DESC, created_at ASC
    `);
    const reviewTasksStmt = ccDb.prepare(`
      SELECT id, title, status, updated_at
      FROM issues
      WHERE assignee = ? AND archived = 0
      AND status = 'review'
      ORDER BY updated_at ASC
    `);
    const blockedTasksStmt = ccDb.prepare(`
      SELECT id, title, status, priority, created_at
      FROM issues
      WHERE assignee = ? AND archived = 0
      AND status = 'blocked'
      ORDER BY priority DESC, created_at ASC
    `);
    const activityCountStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM activities
      WHERE actor = ?
      AND created_at BETWEEN ? AND ?
    `);
    const commentCountStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM comments
      WHERE author = ?
      AND created_at BETWEEN ? AND ?
    `);

    // Generate standup data for each agent
    const standupData = agents.map(agent => {
      const completedTasks = completedTasksStmt.all(agent.name, startOfDayISO, endOfDayISO);
      const inProgressTasks = inProgressTasksStmt.all(agent.name);
      const assignedTasks = assignedTasksStmt.all(agent.name);
      const reviewTasks = reviewTasksStmt.all(agent.name);
      const blockedTasks = blockedTasksStmt.all(agent.name);
      const activityCount = activityCountStmt.get(agent.name, startOfDayUnix, endOfDayUnix) as { count: number };
      const commentsToday = commentCountStmt.get(agent.name, startOfDayUnix, endOfDayUnix) as { count: number };

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
    
    // CC issues don't have due_date, so overdue tracking is skipped
    const overdueTasks: any[] = [];
    
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
      INSERT OR REPLACE INTO standup_reports (date, report, created_at)
      VALUES (?, ?, ?)
    `).run(targetDate, JSON.stringify(standupReport), createdAt);
    
    // Log the standup generation
    db_helpers.logActivity(
      'standup_generated',
      'standup',
      0, // No specific entity
      'system',
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
      }
    );
    
    return NextResponse.json({ standup: standupReport });
  } catch (error) {
    console.error('POST /api/standup/generate error:', error);
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

    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    
    const standupRows = db.prepare(`
      SELECT date, report, created_at
      FROM standup_reports
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as Array<{ date: string; report: string; created_at: number }>;

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
    
    const countRow = db.prepare('SELECT COUNT(*) as total FROM standup_reports').get() as { total: number };

    return NextResponse.json({
      history: standupHistory,
      total: countRow.total,
      page: Math.floor(offset / limit) + 1,
      limit
    });
  } catch (error) {
    console.error('GET /api/standup/history error:', error);
    return NextResponse.json({ error: 'Failed to fetch standup history' }, { status: 500 });
  }
}
