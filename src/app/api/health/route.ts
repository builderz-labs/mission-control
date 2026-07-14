import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'

/**
 * Public, unauthenticated health endpoint for upstream watchdogs (deploy
 * scripts, container orchestrators, external uptime probes).
 *
 * Returns 200 + {status:"ok"} when the SQLite DB is reachable, 503 +
 * {status:"degraded"} otherwise.
 *
 * Intentionally minimal: it does NOT expose row counts, usernames, config, or
 * raw error messages to anonymous callers — only a coarse reachability signal.
 * Do NOT add requireRole/auth here (its purpose is anonymous reachability), and
 * do NOT echo exception details (info disclosure). Mirrors the no-detail
 * contract of /api/status?action=health.
 */
export async function GET() {
  const ts = new Date().toISOString()
  try {
    const db = getDatabase()
    db.prepare('SELECT 1').get()
    return NextResponse.json({ status: 'ok', db: 'ok', ts })
  } catch {
    // Deliberately no error detail in the response body.
    return NextResponse.json({ status: 'degraded', db: 'error', ts }, { status: 503 })
  }
}
