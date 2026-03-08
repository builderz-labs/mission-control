import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getCCDatabase, setTaskPicked, getTurns } from '@/lib/cc-db';

/**
 * POST /api/tasks/pick — automatic task assignment
 *
 * Body: { agent: string }  (required — who's picking up work)
 *
 * Finds the highest-priority, oldest open task assigned to this agent
 * that isn't already picked by someone else. Returns full task context.
 *
 * Priority order: urgent > high > normal > low, then oldest first.
 *
 * Returns 204 (no content) if no tasks available — agent should stop.
 *
 * Agent mapping: if agent is "ralph", also picks up tasks assigned to "cody"
 * (Ralph is Cody's PM and handles delegation).
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({}));
    const agent = body.agent;

    if (!agent || typeof agent !== 'string') {
      return NextResponse.json(
        { error: 'agent is required — identify yourself' },
        { status: 400 }
      );
    }

    const db = getCCDatabase();

    // Build assignee list — ralph also picks up cody's tasks
    const assignees: string[] = [agent, agent.toLowerCase()];
    // Capitalize first letter variant
    const capitalized = agent.charAt(0).toUpperCase() + agent.slice(1).toLowerCase();
    if (!assignees.includes(capitalized)) assignees.push(capitalized);

    if (agent.toLowerCase() === 'ralph') {
      assignees.push('cody', 'Cody');
    }

    const placeholders = assignees.map(() => '?').join(',');

    // Find highest priority, oldest task that's open and not already picked
    const issue = db.prepare(`
      SELECT * FROM issues
      WHERE status = 'open'
        AND LOWER(assignee) IN (${assignees.map(a => '?').join(',')})
        AND (picked = 0 OR picked IS NULL)
        AND archived = 0
      ORDER BY
        CASE priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END,
        created_at ASC
      LIMIT 1
    `).get(...assignees.map(a => a.toLowerCase())) as Record<string, unknown> | undefined;

    if (!issue) {
      // No tasks available
      return new NextResponse(null, { status: 204 });
    }

    const taskId = issue.id as string;

    // Record the pick
    setTaskPicked(taskId, agent);

    // Get all turns for context
    const turns = getTurns(taskId);

    // Determine if this task needs refinement
    const description = (issue.description as string) || '';
    const hasDescription = description.trim().length > 0;
    const needsRefinement = turns.length === 0 && !hasDescription;

    return NextResponse.json({
      id: taskId,
      title: issue.title as string,
      description,
      status: issue.status as string,
      assignee: issue.assignee as string,
      priority: issue.priority as string,
      plan_path: (issue.plan_path as string) || null,
      turns,
      needs_refinement: needsRefinement,
    });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/pick error');
    return NextResponse.json({ error: 'Failed to pick task' }, { status: 500 });
  }
}
