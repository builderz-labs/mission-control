import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { existsSync } from 'fs'
import path from 'path'
import Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// WatsonFlow DB connection
// Reads from WatsonFlow's SQLite directly (read-only). No writes in Phase 1.
// Connection is a singleton — reused across requests to avoid FD churn.
// WAL mode is enabled on the source DB; concurrent reads are safe.
// ---------------------------------------------------------------------------

const WATSONFLOW_DB_PATH =
  process.env.WATSONFLOW_DB_PATH ||
  path.join(process.env.HOME || '/Users/watson', '.openclaw/agents/main/workspace/data/watsonflow.db')

let _db: Database.Database | null = null

function getWatsonFlowDb(): Database.Database {
  if (_db) return _db

  if (!existsSync(WATSONFLOW_DB_PATH)) {
    throw Object.assign(new Error(`WatsonFlow database not found at: ${WATSONFLOW_DB_PATH}`), {
      code: 'WATSONFLOW_NOT_FOUND',
    })
  }

  try {
    const db = new Database(WATSONFLOW_DB_PATH, { readonly: true, timeout: 3000 })
    db.pragma('busy_timeout = 3000') // wait up to 3s if WAL checkpoint is running
    _db = db
    return _db
  } catch (err: any) {
    if (err?.message?.includes('locked')) {
      throw Object.assign(new Error('WatsonFlow database is locked. Is the daemon running?'), {
        code: 'WATSONFLOW_LOCKED',
      })
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// GET /api/watsonflow
// Returns: { tasks, ideas, approvals, counts, meta }
// All in one shot — client filters what it needs.
// Auth: requireRole('viewer') — same pattern as tasks API.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // Auth guard — required even for read-only endpoints
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const db = getWatsonFlowDb()

    // Active tasks (not terminal states)
    const tasks = db
      .prepare(
        `SELECT id, title, type, agent, status, priority, scope,
                created_at, dispatched_at, completed_at, goal,
                discord_channel, failure_reason, tags
         FROM tasks
         ORDER BY created_at DESC
         LIMIT 100`
      )
      .all()

    // All ideas, newest first
    const ideas = db
      .prepare(
        `SELECT id, timestamp, raw_text, transcription, status,
                scoped_task_id, channel_id, created_at, goals, clarification_reason
         FROM ideas
         ORDER BY created_at DESC
         LIMIT 100`
      )
      .all()

    // Pending approvals (waiting or snoozed)
    const approvals = db
      .prepare(
        `SELECT id, task_id, type, title, description, proposed_action,
                risk, agent, priority, status, created_at, snooze_until
         FROM pending_approvals
         WHERE status IN ('waiting', 'snoozed')
         ORDER BY created_at DESC`
      )
      .all()

    // Counts — derived server-side so clients don't have to aggregate
    const taskStatuses = db
      .prepare(`SELECT status, COUNT(*) as count FROM tasks GROUP BY status`)
      .all() as { status: string; count: number }[]

    const statusMap = Object.fromEntries(taskStatuses.map((r) => [r.status, r.count]))

    const counts = {
      tasks_total: tasks.length,
      tasks_active: (tasks as any[]).filter(
        (t) => !['complete', 'failed', 'cancelled'].includes(t.status)
      ).length,
      ideas_total: ideas.length,
      ideas_inbox: (ideas as any[]).filter((i) => i.status === 'inbox').length,
      approvals_pending: (approvals as any[]).filter((a) => a.status === 'waiting').length,
      by_status: statusMap,
    }

    // Freshness — lets frontend detect stale data if daemon goes down
    const freshness = db
      .prepare(`SELECT MAX(created_at) as last_idea FROM ideas`)
      .get() as { last_idea: string | null }

    const meta = {
      source: 'watsonflow_db',
      db_path: WATSONFLOW_DB_PATH,
      wal_mode: true,
      last_idea: freshness?.last_idea ?? null,
      fetched_at: new Date().toISOString(),
    }

    return NextResponse.json({ tasks, ideas, approvals, counts, meta })
  } catch (err: any) {
    const isUnavailable =
      err?.code === 'WATSONFLOW_NOT_FOUND' || err?.code === 'WATSONFLOW_LOCKED'

    return NextResponse.json(
      {
        error: err?.message ?? 'WatsonFlow query failed',
        available: false,
      },
      { status: isUnavailable ? 503 : 500 }
    )
  }
}
