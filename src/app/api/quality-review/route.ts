import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const taskIdsParam = searchParams.get('taskIds')
    const taskId = parseInt(searchParams.get('taskId') || '')

    if (taskIdsParam) {
      const ids = taskIdsParam
        .split(',')
        .map((id) => parseInt(id.trim()))
        .filter((id) => !Number.isNaN(id))

      if (ids.length === 0) {
        return NextResponse.json({ error: 'taskIds must include at least one numeric id' }, { status: 400 })
      }

      const placeholders = ids.map(() => '?').join(',')
      const rows = db.prepare(`
        SELECT * FROM quality_reviews
        WHERE task_id IN (${placeholders})
        ORDER BY task_id ASC, created_at DESC
      `).all(...ids) as Array<{ task_id: number; reviewer?: string; status?: string; created_at?: number }>

      const byTask: Record<number, { status?: string; reviewer?: string; created_at?: number } | null> = {}
      for (const id of ids) {
        byTask[id] = null
      }

      for (const row of rows) {
        const existing = byTask[row.task_id]
        if (!existing || (row.created_at || 0) > (existing.created_at || 0)) {
          byTask[row.task_id] = { status: row.status, reviewer: row.reviewer, created_at: row.created_at }
        }
      }

      return NextResponse.json({ latest: byTask })
    }

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
    }

    const reviews = db.prepare(`
      SELECT * FROM quality_reviews
      WHERE task_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(taskId)

    return NextResponse.json({ reviews })
  } catch (error) {
    console.error('GET /api/quality-review error:', error)
    return NextResponse.json({ error: 'Failed to fetch quality reviews' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDatabase()
    const body = await request.json()
    const taskId = parseInt(body.taskId)
    const reviewer = (body.reviewer || 'aegis').trim()
    const status = (body.status || '').trim()
    const notes = body.notes ? String(body.notes) : null

    if (isNaN(taskId) || !reviewer || !status) {
      return NextResponse.json({ error: 'taskId, reviewer, and status are required' }, { status: 400 })
    }

    if (!['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'status must be approved or rejected' }, { status: 400 })
    }
    if (!notes || !String(notes).trim()) {
      return NextResponse.json({ error: 'notes are required for quality reviews' }, { status: 400 })
    }

    const task = db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(taskId) as any
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const result = db.prepare(`
      INSERT INTO quality_reviews (task_id, reviewer, status, notes)
      VALUES (?, ?, ?, ?)
    `).run(taskId, reviewer, status, notes)

    db_helpers.logActivity(
      'quality_review',
      'task',
      taskId,
      reviewer,
      `Quality review ${status} for task: ${task.title}`,
      { status, notes }
    )

    return NextResponse.json({ success: true, id: result.lastInsertRowid })
  } catch (error) {
    console.error('POST /api/quality-review error:', error)
    return NextResponse.json({ error: 'Failed to create quality review' }, { status: 500 })
  }
}
