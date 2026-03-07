import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

interface AccessRequestRow {
  id: number
  provider: string
  email: string
  provider_user_id: string | null
  display_name: string | null
  avatar_url: string | null
  status: 'pending' | 'approved' | 'rejected'
  requested_at: number
  last_attempt_at: number
  attempt_count: number
  reviewed_by: string | null
  reviewed_at: number | null
  review_note: string | null
  approved_user_id: number | null
}

export async function GET(request: Request) {
  const user = getUserFromRequest(request)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const db = getDatabase()
  const pendingRows = db.prepare(
    `SELECT id, provider, email, provider_user_id, display_name, avatar_url, status, requested_at, last_attempt_at, attempt_count
     FROM access_requests
     WHERE status = ?
     ORDER BY last_attempt_at DESC, id DESC`
  ).all('pending') as AccessRequestRow[]

  const resolvedRows = db.prepare(
    `SELECT id, provider, email, provider_user_id, display_name, avatar_url, status, requested_at, last_attempt_at, attempt_count,
            reviewed_by, reviewed_at, review_note, approved_user_id
     FROM access_requests
     WHERE status IN (?, ?)
     ORDER BY reviewed_at DESC, id DESC
     LIMIT 20`
  ).all('approved', 'rejected') as AccessRequestRow[]

  interface SessionRow {
    expires_at: number | null
  }

  const sessionStmt = db.prepare('SELECT expires_at FROM user_sessions WHERE user_id = ? ORDER BY expires_at DESC LIMIT 1') as { get: (id: number) => SessionRow | undefined }

  const pending = pendingRows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    providerUserId: row.provider_user_id,
    attemptCount: row.attempt_count,
    requestedAt: row.requested_at,
    lastAttemptAt: row.last_attempt_at,
  }))

  const history = resolvedRows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    providerUserId: row.provider_user_id,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    note: row.review_note,
    expiresAt: row.approved_user_id
      ? (sessionStmt.get(row.approved_user_id)?.expires_at ?? null)
      : null,
    attemptCount: row.attempt_count,
    requestedAt: row.requested_at,
    lastAttemptAt: row.last_attempt_at,
  }))

  return NextResponse.json(
    { pending, history },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
