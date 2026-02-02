import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, Comment, db_helpers } from '@/lib/db';

/**
 * GET /api/tasks/[id]/comments - Get all comments for a task
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const taskId = parseInt(resolvedParams.id);
    
    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    
    // Verify task exists
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    
    // Get comments ordered by creation time
    const stmt = db.prepare(`
      SELECT * FROM comments 
      WHERE task_id = ? 
      ORDER BY created_at ASC
    `);
    
    const comments = stmt.all(taskId) as Comment[];
    
    // Parse JSON fields and build thread structure
    const commentsWithParsedData = comments.map(comment => ({
      ...comment,
      mentions: comment.mentions ? JSON.parse(comment.mentions) : []
    }));
    
    // Organize into thread structure (parent comments with replies)
    const commentMap = new Map();
    const topLevelComments: any[] = [];
    
    // First pass: create all comment objects
    commentsWithParsedData.forEach(comment => {
      commentMap.set(comment.id, { ...comment, replies: [] });
    });
    
    // Second pass: organize into threads
    commentsWithParsedData.forEach(comment => {
      const commentWithReplies = commentMap.get(comment.id);
      
      if (comment.parent_id) {
        // This is a reply, add to parent's replies
        const parent = commentMap.get(comment.parent_id);
        if (parent) {
          parent.replies.push(commentWithReplies);
        }
      } else {
        // This is a top-level comment
        topLevelComments.push(commentWithReplies);
      }
    });
    
    return NextResponse.json({ 
      comments: topLevelComments,
      total: comments.length
    });
  } catch (error) {
    console.error(`GET /api/tasks/[id]/comments error:`, error);
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
  try {
    const db = getDatabase();
    const resolvedParams = await params;
    const taskId = parseInt(resolvedParams.id);
    const body = await request.json();
    
    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    
    const { content, author = 'system', parent_id } = body;
    
    if (!content || !content.trim()) {
      return NextResponse.json({ error: 'Comment content is required' }, { status: 400 });
    }
    
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
    
    const result = stmt.run(
      taskId,
      author,
      content,
      now,
      parent_id || null,
      mentions.length > 0 ? JSON.stringify(mentions) : null
    );
    
    const commentId = result.lastInsertRowid as number;
    
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
    
    // Create notifications for @mentions
    if (mentions.length > 0) {
      const uniqueMentions = Array.from(new Set(mentions)); // Remove duplicates
      
      for (const mentionedAgent of uniqueMentions) {
        // Don't notify the author about their own mentions
        if (mentionedAgent !== author) {
          db_helpers.createNotification(
            mentionedAgent,
            'mention',
            'You were mentioned',
            `${author} mentioned you in a comment on "${task.title}": ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`,
            'comment',
            commentId
          );
        }
      }
    }
    
    // Also notify task assignee about new comments (unless they're the author)
    if (task.assigned_to && task.assigned_to !== author) {
      db_helpers.createNotification(
        task.assigned_to,
        'comment',
        'New comment on your task',
        `${author} commented on "${task.title}": ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`,
        'comment',
        commentId
      );
    }
    
    // Fetch the created comment
    const createdComment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId) as Comment;
    
    return NextResponse.json({ 
      comment: {
        ...createdComment,
        mentions: createdComment.mentions ? JSON.parse(createdComment.mentions) : [],
        replies: [] // New comments have no replies initially
      }
    }, { status: 201 });
  } catch (error) {
    console.error(`POST /api/tasks/[id]/comments error:`, error);
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}