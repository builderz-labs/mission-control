import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getIssue, setTaskPicked, getTurns } from '@/lib/cc-db';

/**
 * POST /api/tasks/[id]/pick — pick a specific task by ID (fallback/manual use)
 *
 * Body: { agent: string }
 *
 * Prefer POST /api/tasks/pick (no ID) for automatic priority-based assignment.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { id: taskId } = await params;
    const body = await request.json().catch(() => ({}));
    const agent = body.agent;

    if (!agent || typeof agent !== 'string') {
      return NextResponse.json(
        { error: 'agent is required — identify yourself' },
        { status: 400 }
      );
    }

    const issue = getIssue(taskId);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (issue.status === 'closed') {
      return NextResponse.json({ error: 'Task is closed' }, { status: 400 });
    }

    // Record the pick
    setTaskPicked(taskId, agent);

    // Get all turns for context
    const turns = getTurns(taskId);

    // Determine if this task needs refinement (no turns, no meaningful description)
    const hasDescription = issue.description && issue.description.trim().length > 0;
    const needsRefinement = turns.length === 0 && !hasDescription;

    return NextResponse.json({
      id: issue.id,
      title: issue.title,
      description: issue.description || '',
      status: issue.status,
      assignee: issue.assignee,
      priority: issue.priority,
      plan_path: issue.plan_path || null,
      turns,
      needs_refinement: needsRefinement,
    });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/pick error');
    return NextResponse.json({ error: 'Failed to pick task' }, { status: 500 });
  }
}
