import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { extractClientIp } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const user = auth.user

  if (user.provider !== 'google') {
    return NextResponse.json({ error: 'Account is not connected to Google' }, { status: 400 })
  }

  const db = getDatabase()

  // Check that the user has a password set so they can still log in after disconnect
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash?: string } | undefined
  if (!row?.password_hash) {
    return NextResponse.json(
      { error: 'Cannot disconnect Google — no password set. Set a password first to avoid being locked out.' },
      { status: 400 }
    )
  }

  db.prepare(`
    UPDATE users
    SET provider = 'local', provider_user_id = NULL, updated_at = (unixepoch())
    WHERE id = ?
  `).run(user.id)

  const ipAddress = extractClientIp(request)
  const userAgent = request.headers.get('user-agent') || undefined
  logAuditEvent({
    action: 'google_disconnect',
    actor: user.username,
    actor_id: user.id,
    ip_address: ipAddress,
    user_agent: userAgent,
  })

  return NextResponse.json({ ok: true })
}
