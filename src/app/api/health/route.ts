import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * Public, unauthenticated health endpoint for upstream watchdogs
 * (Pandora backend, deploy scripts, external uptime probes).
 *
 * Returns 200 + {status: "ok"} when the SQLite DB is reachable and
 * the tasks table is queryable. Returns 503 + {status: "degraded"}
 * on any DB error.
 *
 * Do NOT add requireRole / auth to this handler — its sole purpose
 * is being callable by anonymous probes. Sensitive details are
 * intentionally NOT exposed (no row IDs, no usernames, no config).
 */
export async function GET() {
  const ts = new Date().toISOString()
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT COUNT(*) as n FROM tasks LIMIT 1').get() as { n: number }
    return NextResponse.json({
      status: 'ok',
      db: 'ok',
      task_count: row.n,
      ts,
    })
  } catch (e: any) {
    const errMsg = String(e?.message ?? e).slice(0, 200)
    return NextResponse.json(
      {
        status: 'degraded',
        db: 'error',
        error: errMsg,
        ts,
      },
      { status: 503 }
    )
  }
}
