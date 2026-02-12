import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { createSession } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { verifyGoogleIdToken } from '@/lib/google-auth'
import { getMcSessionCookieOptions } from '@/lib/session-cookie'

function upsertAccessRequest(input: {
  email: string
  providerUserId: string
  displayName: string
  avatarUrl?: string
}) {
  const db = getDatabase()
  db.prepare(`
    INSERT INTO access_requests (provider, email, provider_user_id, display_name, avatar_url, status, attempt_count, requested_at, last_attempt_at)
    VALUES ('google', ?, ?, ?, ?, 'pending', 1, (unixepoch()), (unixepoch()))
    ON CONFLICT(email, provider) DO UPDATE SET
      provider_user_id = excluded.provider_user_id,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      status = 'pending',
      attempt_count = access_requests.attempt_count + 1,
      last_attempt_at = (unixepoch())
  `).run(input.email.toLowerCase(), input.providerUserId, input.displayName, input.avatarUrl || null)
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const credential = String(body?.credential || '')
    const profile = await verifyGoogleIdToken(credential)

    const db = getDatabase()
    const email = String(profile.email || '').toLowerCase().trim()
    const sub = String(profile.sub || '').trim()
    const displayName = String(profile.name || email.split('@')[0] || 'Google User').trim()
    const avatar = profile.picture ? String(profile.picture) : null

    const row = db.prepare(`
      SELECT id, username, display_name, role, provider, email, avatar_url, is_approved, created_at, updated_at, last_login_at
      FROM users
      WHERE (provider = 'google' AND provider_user_id = ?) OR lower(email) = ?
      ORDER BY id ASC
      LIMIT 1
    `).get(sub, email) as any

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const userAgent = request.headers.get('user-agent') || undefined

    if (!row || Number(row.is_approved ?? 1) !== 1) {
      upsertAccessRequest({
        email,
        providerUserId: sub,
        displayName,
        avatarUrl: avatar || undefined,
      })

      logAuditEvent({
        action: 'google_login_pending_approval',
        actor: email,
        detail: { email, sub },
        ip_address: ipAddress,
        user_agent: userAgent,
      })

      return NextResponse.json(
        { error: 'Access request pending admin approval', code: 'PENDING_APPROVAL' },
        { status: 403 }
      )
    }

    db.prepare(`
      UPDATE users
      SET provider = 'google', provider_user_id = ?, email = ?, avatar_url = COALESCE(?, avatar_url), updated_at = (unixepoch())
      WHERE id = ?
    `).run(sub, email, avatar, row.id)

    const { token, expiresAt } = createSession(row.id, ipAddress, userAgent)

    logAuditEvent({ action: 'login_google', actor: row.username, actor_id: row.id, ip_address: ipAddress, user_agent: userAgent })

    const response = NextResponse.json({
      user: {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
        provider: 'google',
        email,
        avatar_url: avatar,
      },
    })

    response.cookies.set('mc-session', token, {
      ...getMcSessionCookieOptions({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000) }),
    })

    return response
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Google login failed' }, { status: 400 })
  }
}
