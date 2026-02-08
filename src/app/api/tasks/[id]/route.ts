import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, Task, db_helpers } from '@/lib/db';
import { eventBus } from '@/lib/event-bus';
import { getUserFromRequest } from '@/lib/auth';

function hasAegisApproval(db: ReturnType<typeof getDatabase>, taskId: number): boolean {
  const review = db.prepare(`
    SELECT status FROM quality_reviews
    WHERE task_id = ? AND reviewer = 'aegis'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(taskId) as { status?: string } | undefined
  return review?.status === 'approved'
}

/**
 * GET /api/tasks/[id] - Get a specific task
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
    
    const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
    const task = stmt.get(taskId) as Task;
    
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    
    // Parse JSON fields
    const taskWithParsedData = {
      ...task,
      tags: task.tags ? JSON.parse(task.tags) : [],
      metadata: task.metadata ? JSON.parse(task.metadata) : {}
    };
    
    return NextResponse.json({ task: taskWithParsedData });
  } catch (error) {
    console.error('GET /api/tasks/[id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
  }
}

/**
 * PUT /api/tasks/[id] - Update a specific task
 */
export async function PUT(
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
    
    // Get current task for comparison
    const currentTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task;
    
    if (!currentTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    
    const {
      title,
      description,
      status,
      priority,
      assigned_to,
      due_date,
      estimated_hours,
      actual_hours,
      tags,
      metadata
    } = body;
    
    const now = Math.floor(Date.now() / 1000);
    
    // Build dynamic update query
    const fieldsToUpdate = [];
    const updateParams: any[] = [];
    
    if (title !== undefined) {
      fieldsToUpdate.push('title = ?');
      updateParams.push(title);
    }
    if (description !== undefined) {
      fieldsToUpdate.push('description = ?');
      updateParams.push(description);
    }
    if (status !== undefined) {
      if (status === 'done' && !hasAegisApproval(db, taskId)) {
        return NextResponse.json(
          { error: 'Aegis approval is required to move task to done.' },
          { status: 403 }
        )
      }
      fieldsToUpdate.push('status = ?');
      updateParams.push(status);
    }
    if (priority !== undefined) {
      fieldsToUpdate.push('priority = ?');
      updateParams.push(priority);
    }
    if (assigned_to !== undefined) {
      fieldsToUpdate.push('assigned_to = ?');
      updateParams.push(assigned_to);
    }
    if (due_date !== undefined) {
      fieldsToUpdate.push('due_date = ?');
      updateParams.push(due_date);
    }
    if (estimated_hours !== undefined) {
      fieldsToUpdate.push('estimated_hours = ?');
      updateParams.push(estimated_hours);
    }
    if (actual_hours !== undefined) {
      fieldsToUpdate.push('actual_hours = ?');
      updateParams.push(actual_hours);
    }
    if (tags !== undefined) {
      fieldsToUpdate.push('tags = ?');
      updateParams.push(JSON.stringify(tags));
    }
    if (metadata !== undefined) {
      fieldsToUpdate.push('metadata = ?');
      updateParams.push(JSON.stringify(metadata));
    }
    
    fieldsToUpdate.push('updated_at = ?');
    updateParams.push(now);
    updateParams.push(taskId);
    
    if (fieldsToUpdate.length === 1) { // Only updated_at
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }
    
    const stmt = db.prepare(`
      UPDATE tasks 
      SET ${fieldsToUpdate.join(', ')}
      WHERE id = ?
    `);
    
    stmt.run(...updateParams);
    
    // Track changes and log activities
    const changes: string[] = [];
    
    if (status && status !== currentTask.status) {
      changes.push(`status: ${currentTask.status} → ${status}`);
      
      // Create notification for status change if assigned
      if (currentTask.assigned_to) {
        db_helpers.createNotification(
          currentTask.assigned_to,
          'status_change',
          'Task Status Updated',
          `Task "${currentTask.title}" status changed to ${status}`,
          'task',
          taskId
        );
      }
    }
    
    if (assigned_to !== undefined && assigned_to !== currentTask.assigned_to) {
      changes.push(`assigned: ${currentTask.assigned_to || 'unassigned'} → ${assigned_to || 'unassigned'}`);
      
      // Create notification for new assignee
      if (assigned_to) {
        db_helpers.ensureTaskSubscription(taskId, assigned_to);
        db_helpers.createNotification(
          assigned_to,
          'assignment',
          'Task Assigned',
          `You have been assigned to task: ${currentTask.title}`,
          'task',
          taskId
        );
      }
    }
    
    if (title && title !== currentTask.title) {
      changes.push('title updated');
    }
    
    if (priority && priority !== currentTask.priority) {
      changes.push(`priority: ${currentTask.priority} → ${priority}`);
    }
    
    // Log activity if there were meaningful changes
    if (changes.length > 0) {
      db_helpers.logActivity(
        'task_updated',
        'task',
        taskId,
        getUserFromRequest(request)?.username || 'system',
        `Task updated: ${changes.join(', ')}`,
        { 
          changes: changes,
          oldValues: {
            title: currentTask.title,
            status: currentTask.status,
            priority: currentTask.priority,
            assigned_to: currentTask.assigned_to
          },
          newValues: { title, status, priority, assigned_to }
        }
      );
    }
    
    // Fetch updated task
    const updatedTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task;
    const parsedTask = {
      ...updatedTask,
      tags: updatedTask.tags ? JSON.parse(updatedTask.tags) : [],
      metadata: updatedTask.metadata ? JSON.parse(updatedTask.metadata) : {}
    };

    // Broadcast to SSE clients
    eventBus.broadcast('task.updated', parsedTask);

    return NextResponse.json({ task: parsedTask });
  } catch (error) {
    console.error('PUT /api/tasks/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

/**
 * DELETE /api/tasks/[id] - Delete a specific task
 */
export async function DELETE(
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
    
    // Get task before deletion for logging
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task;
    
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    
    // Delete task (cascades will handle comments)
    const stmt = db.prepare('DELETE FROM tasks WHERE id = ?');
    stmt.run(taskId);
    
    // Log deletion
    db_helpers.logActivity(
      'task_deleted',
      'task',
      taskId,
      getUserFromRequest(request)?.username || 'system',
      `Deleted task: ${task.title}`,
      {
        title: task.title,
        status: task.status,
        assigned_to: task.assigned_to
      }
    );

    // Broadcast to SSE clients
    eventBus.broadcast('task.deleted', { id: taskId, title: task.title });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/tasks/[id] error:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
