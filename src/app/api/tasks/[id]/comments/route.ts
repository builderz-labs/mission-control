import { NextRequest, NextResponse } from 'next/server';
import { db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  getIssue,
  getIssueComments,
  mapCCComment,
  getCCDatabaseWrite,
} from '@/lib/cc-db';
import { randomUUID } from 'crypto';

/**
 * GET /api/tasks/[id]/comments - Get all comments for an issue from control-center.db
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const resolvedParams = await params;
    const issueId = resolvedParams.id;

    const issue = getIssue(issueId);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const rawComments = getIssueComments(issueId);
    const comments = rawComments.map(mapCCComment);

    return NextResponse.json({
      comments,
      total: comments.length,
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/[id]/comments error');
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
  }
}

/**
 * POST /api/tasks/[id]/comments - Add a comment to an issue in control-center.db
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateCheck = mutationLimiter(request);
  if (rateCheck) return rateCheck;

  try {
    const resolvedParams = await params;
    const issueId = resolvedParams.id;
    const body = await request.json();

    const { content, author = 'system' } = body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Comment content is required' }, { status: 400 });
    }

    const issue = getIssue(issueId);
    if (!issue) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const writeDb = getCCDatabaseWrite();
    try {
      writeDb.prepare(`
        INSERT INTO issue_comments (id, issue_id, author, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, issueId, author, content, now);
    } finally {
      writeDb.close();
    }

    const mentions = db_helpers.parseMentions(content);

    db_helpers.logActivity(
      'comment_added',
      'comment',
      0,
      author,
      `Added comment to task: ${issue.title}`,
      { task_id: issueId, task_title: issue.title, content_preview: content.substring(0, 100) }
    );

    const comment = {
      id,
      task_id: issueId,
      author,
      content,
      created_at: Math.floor(new Date(now).getTime() / 1000),
      mentions,
      replies: [],
    };

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/comments error');
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}
