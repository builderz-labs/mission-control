import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, Comment, db_helpers } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { validateBody, createCommentSchema } from '@/lib/validation';
import { mutationLimiter } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const MAX_COMMENT_PAGE_SIZE = 100;

const parseMentionsSafely = (commentId: number, mentions?: string | null): string[] => {
  if (!mentions) {
    return [];
  }

  try {
    return JSON.parse(mentions);
  } catch (error) {
    logger.warn({ commentId, err: error }, 'Failed to parse comment mentions payload');
    return [];
  }
};

/**
 * GET /api/tasks/[id]/comments - Get all comments for a task
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const taskId = parseInt(resolvedParams.id, 10);

    if (Number.isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    // Verify task exists
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const searchParams = new URL(request.url).searchParams;
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const cursorParam = searchParams.get('cursor');

    if (!limitParam) {
      return NextResponse.json({ error: 'limit query parameter is required to paginate comments' }, { status: 400 });
    }

    const limit = Number(limitParam);
    if (!Number.isInteger(limit) || limit <= 0) {
      return NextResponse.json({ error: 'limit must be a positive integer' }, { status: 400 });
    }
    if (limit > MAX_COMMENT_PAGE_SIZE) {
      return NextResponse.json({ error: `limit cannot exceed ${MAX_COMMENT_PAGE_SIZE}` }, { status: 400 });
    }

    const offset = offsetParam !== null ? Number(offsetParam) : 0;
    if (!Number.isInteger(offset) || offset < 0) {
      return NextResponse.json({ error: 'offset must be a non-negative integer' }, { status: 400 });
    }

    let useCursor = false;
    let cursorId: number | null = null;
    let cursorCreatedAt: number | null = null;

    if (cursorParam) {
      const parsedCursorId = Number(cursorParam);
      if (!Number.isInteger(parsedCursorId) || parsedCursorId <= 0) {
        return NextResponse.json({ error: 'cursor must be a positive integer referencing a top-level comment' }, { status: 400 });
      }

      const cursorComment = db.prepare('SELECT id, created_at FROM comments WHERE id = ? AND task_id = ? AND parent_id IS NULL').get(parsedCursorId, taskId) as { id: number; created_at: number } | undefined;
      if (!cursorComment) {
        return NextResponse.json({ error: 'Cursor references an unknown comment' }, { status: 400 });
      }

      useCursor = true;
      cursorId = cursorComment.id;
      cursorCreatedAt = cursorComment.created_at;
    }

    if (useCursor && offsetParam !== null) {
      return NextResponse.json({ error: 'cursor and offset cannot be combined' }, { status: 400 });
    }

    const totalCommentsResult = db.prepare('SELECT COUNT(*) as count FROM comments WHERE task_id = ?').get(taskId) as { count: number };
    const totalTopLevelResult = db.prepare('SELECT COUNT(*) as count FROM comments WHERE task_id = ? AND parent_id IS NULL').get(taskId) as { count: number };
    const totalComments = totalCommentsResult.count;
    const totalTopLevelComments = totalTopLevelResult.count;

    let topLevelQuery = `
      SELECT * FROM comments
      WHERE task_id = ?
        AND parent_id IS NULL
    `;
    const queryParams: any[] = [taskId];

    if (useCursor && cursorCreatedAt !== null && cursorId !== null) {
      topLevelQuery += `
        AND (created_at > ? OR (created_at = ? AND id > ?))
      `;
      queryParams.push(cursorCreatedAt, cursorCreatedAt, cursorId);
    }

    topLevelQuery += `
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `;
    queryParams.push(limit);

    if (!useCursor) {
      topLevelQuery += ' OFFSET ?';
      queryParams.push(offset);
    }

    const topLevelStmt = db.prepare(topLevelQuery);
    const topLevelComments = topLevelStmt.all(...queryParams) as Comment[];

    const allComments: Comment[] = [...topLevelComments];
    let queue = topLevelComments.map((comment) => comment.id);

    while (queue.length > 0) {
      const placeholders = queue.map(() => '?').join(', ');
      const repliesStmt = db.prepare(`
        SELECT * FROM comments
        WHERE task_id = ?
          AND parent_id IN (${placeholders})
        ORDER BY created_at ASC, id ASC
      `);
      const replies = repliesStmt.all(taskId, ...queue) as Comment[];
      if (!replies.length) {
        break;
      }
      allComments.push(...replies);
      queue = replies.map((reply) => reply.id);
    }

    const commentWithMentions = allComments.map((comment) => ({
      ...comment,
      mentions: parseMentionsSafely(comment.id, comment.mentions)
    }));

    type CommentNode = typeof commentWithMentions[number] & { replies: CommentNode[] };

    const commentNodeMap = new Map<number, CommentNode>();
    commentWithMentions.forEach((comment) => {
      commentNodeMap.set(comment.id, { ...comment, replies: [] });
    });

    commentWithMentions.forEach((comment) => {
      if (!comment.parent_id) return;
      const node = commentNodeMap.get(comment.id);
      const parentNode = commentNodeMap.get(comment.parent_id);
      if (node && parentNode) {
        parentNode.replies.push(node);
      }
    });

    const topLevelNodes: CommentNode[] = [];
    topLevelComments.forEach((comment) => {
      const node = commentNodeMap.get(comment.id);
      if (node) {
        topLevelNodes.push(node);
      }
    });

    const hasMoreTopLevel = useCursor
      ? topLevelComments.length === limit
      : offset + topLevelComments.length < totalTopLevelComments;

    const nextCursor = hasMoreTopLevel && topLevelComments.length > 0
      ? String(topLevelComments[topLevelComments.length - 1].id)
      : null;

    const nextOffset = !useCursor && hasMoreTopLevel
      ? offset + topLevelComments.length
      : null;

    const pagination: Record<string, unknown> = {
      limit,
      totalComments,
      totalTopLevelComments,
      hasMore: hasMoreTopLevel
    };

    if (useCursor) {
      pagination.cursor = cursorParam;
      pagination.nextCursor = nextCursor;
    } else {
      pagination.offset = offset;
      pagination.nextOffset = nextOffset;
    }

    return NextResponse.json({
      comments: topLevelNodes,
      pagination
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/tasks/[id]/comments error');
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
  }
}

/**
 * POST /api/tasks/[id]/comments - Add a new comment to a task
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
    const db = getDatabase();
    const resolvedParams = await params;
    const taskId = parseInt(resolvedParams.id);

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    const result = await validateBody(request, createCommentSchema);
    if ('error' in result) return result.error;
    const { content, author = 'system', parent_id } = result.data;
    
    // Verify task exists
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    
    // Verify parent comment exists if specified
    if (parent_id) {
      const parentComment = db.prepare('SELECT id FROM comments WHERE id = ? AND task_id = ?').get(parent_id, taskId);
      if (!parentComment) {
        return NextResponse.json({ error: 'Parent comment not found' }, { status: 404 });
      }
    }
    
    // Parse @mentions from content
    const mentions = db_helpers.parseMentions(content);
    
    const now = Math.floor(Date.now() / 1000);
    
    // Insert comment
    const stmt = db.prepare(`
      INSERT INTO comments (task_id, author, content, created_at, parent_id, mentions)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const insertResult = stmt.run(
      taskId,
      author,
      content,
      now,
      parent_id || null,
      mentions.length > 0 ? JSON.stringify(mentions) : null
    );

    const commentId = insertResult.lastInsertRowid as number;
    
    // Log activity
    const activityDescription = parent_id 
      ? `Replied to comment on task: ${task.title}`
      : `Added comment to task: ${task.title}`;
    
    db_helpers.logActivity(
      'comment_added',
      'comment',
      commentId,
      author,
      activityDescription,
      {
        task_id: taskId,
        task_title: task.title,
        parent_id,
        mentions,
        content_preview: content.substring(0, 100)
      }
    );
    
    // Ensure subscriptions for author, mentions, and assignee
    db_helpers.ensureTaskSubscription(taskId, author);
    const uniqueMentions = Array.from(new Set(mentions));
    uniqueMentions.forEach((mentionedAgent) => {
      db_helpers.ensureTaskSubscription(taskId, mentionedAgent);
    });
    if (task.assigned_to) {
      db_helpers.ensureTaskSubscription(taskId, task.assigned_to);
    }

    // Notify subscribers
    const subscribers = new Set(db_helpers.getTaskSubscribers(taskId));
    subscribers.delete(author);
    const mentionSet = new Set(uniqueMentions);

    for (const subscriber of subscribers) {
      const isMention = mentionSet.has(subscriber);
      db_helpers.createNotification(
        subscriber,
        isMention ? 'mention' : 'comment',
        isMention ? 'You were mentioned' : 'New comment on a subscribed task',
        isMention
          ? `${author} mentioned you in a comment on "${task.title}": ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`
          : `${author} commented on "${task.title}": ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`,
        'comment',
        commentId
      );
    }
    
    // Fetch the created comment
    const createdComment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId) as Comment;
    
    return NextResponse.json({ 
      comment: {
        ...createdComment,
        mentions: parseMentionsSafely(createdComment.id, createdComment.mentions),
        replies: [] // New comments have no replies initially
      }
    }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/tasks/[id]/comments error');
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}
