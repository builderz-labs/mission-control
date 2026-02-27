import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, Task, db_helpers } from '@/lib/db';
import { eventBus } from '@/lib/event-bus';
import { requireRole } from '@/lib/auth';

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
 * GET /api/tasks - List all tasks with optional filtering
 * Query params: status, assigned_to, priority, limit, offset
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const status = searchParams.get('status');
    const assigned_to = searchParams.get('assigned_to');
    const priority = searchParams.get('priority');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    
    // Build dynamic query
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params: any[] = [];
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    if (assigned_to) {
      query += ' AND assigned_to = ?';
      params.push(assigned_to);
    }
    
    if (priority) {
      query += ' AND priority = ?';
      params.push(priority);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const stmt = db.prepare(query);
    const tasks = stmt.all(...params) as Task[];
    
    // Parse JSON fields
    const tasksWithParsedData = tasks.map(task => ({
      ...task,
      tags: task.tags ? JSON.parse(task.tags) : [],
      metadata: task.metadata ? JSON.parse(task.metadata) : {}
    }));
    
    return NextResponse.json({ tasks: tasksWithParsedData, total: tasks.length });
  } catch (error) {
    console.error('GET /api/tasks error:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

/**
 * POST /api/tasks - Create a new task
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const body = await request.json();

    const user = auth.user
    const {
      title,
      description,
      status = 'inbox',
      priority = 'medium',
      assigned_to,
      created_by = user?.username || 'system',
      due_date,
      estimated_hours,
      tags = [],
      metadata = {}
    } = body;
    
    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    
    // Check for duplicate title
    const existingTask = db.prepare('SELECT id FROM tasks WHERE title = ?').get(title);
    if (existingTask) {
      return NextResponse.json({ error: 'Task with this title already exists' }, { status: 409 });
    }
    
    const now = Math.floor(Date.now() / 1000);
    
    const stmt = db.prepare(`
      INSERT INTO tasks (
        title, description, status, priority, assigned_to, created_by,
        created_at, updated_at, due_date, estimated_hours, tags, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      title,
      description,
      status,
      priority,
      assigned_to,
      created_by,
      now,
      now,
      due_date,
      estimated_hours,
      JSON.stringify(tags),
      JSON.stringify(metadata)
    );
    
    const taskId = result.lastInsertRowid as number;
    
    // Log activity
    db_helpers.logActivity('task_created', 'task', taskId, created_by, `Created task: ${title}`, {
      title,
      status,
      priority,
      assigned_to
    });

    if (created_by) {
      db_helpers.ensureTaskSubscription(taskId, created_by)
    }

    // Create notification if assigned
    if (assigned_to) {
      db_helpers.ensureTaskSubscription(taskId, assigned_to)
      db_helpers.createNotification(
        assigned_to,
        'assignment',
        'Task Assigned',
        `You have been assigned to task: ${title}`,
        'task',
        taskId
      );
    }
    
    // Fetch the created task
    const createdTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task;
    const parsedTask = {
      ...createdTask,
      tags: JSON.parse(createdTask.tags || '[]'),
      metadata: JSON.parse(createdTask.metadata || '{}')
    };

    // Broadcast to SSE clients
    eventBus.broadcast('task.created', parsedTask);

    return NextResponse.json({ task: parsedTask }, { status: 201 });
  } catch (error) {
    console.error('POST /api/tasks error:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}

/**
 * PUT /api/tasks - Update multiple tasks (for drag-and-drop status changes)
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = getDatabase();
    const { tasks } = await request.json();

    if (!Array.isArray(tasks)) {
      return NextResponse.json({ error: 'Tasks must be an array' }, { status: 400 });
    }

    const now = Math.floor(Date.now() / 1000);

    const updateStmt = db.prepare(`
      UPDATE tasks
      SET status = ?, updated_at = ?
      WHERE id = ?
    `);

    const actor = auth.user.username

    const transaction = db.transaction((tasksToUpdate: any[]) => {
      for (const task of tasksToUpdate) {
        const oldTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as Task;

        if (task.status === 'done' && !hasAegisApproval(db, task.id)) {
          throw new Error(`Aegis approval required for task ${task.id}`)
        }

        updateStmt.run(task.status, now, task.id);

        // Log status change if different
        if (oldTask && oldTask.status !== task.status) {
          db_helpers.logActivity(
            'task_updated',
            'task',
            task.id,
            actor,
            `Task moved from ${oldTask.status} to ${task.status}`,
            { oldStatus: oldTask.status, newStatus: task.status }
          );
        }
      }
    });
    
    transaction(tasks);

    // Broadcast status changes to SSE clients
    for (const task of tasks) {
      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: task.status,
        updated_at: Math.floor(Date.now() / 1000),
      });
    }

    return NextResponse.json({ success: true, updated: tasks.length });
  } catch (error) {
    console.error('PUT /api/tasks error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update tasks'
    if (message.includes('Aegis approval required')) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to update tasks' }, { status: 500 });
  }
}
