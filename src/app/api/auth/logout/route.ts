import { NextResponse } from 'next/server'
import { destroySession, getUserFromRequest } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { getMcSessionCookieOptions, parseAllMcSessionCookies, MC_SESSION_COOKIE_NAME, LEGACY_MC_SESSION_COOKIE_NAME } from '@/lib/session-cookie'

export async function POST(request: Request) {
  const user = getUserFromRequest(request)
  const cookieHeader = request.headers.get('cookie') || ''
  const tokens = parseAllMcSessionCookies(cookieHeader)

  // Destroy all presented session tokens
  for (const token of tokens) {
    destroySession(token)
  }

  if (user) {
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({ action: 'logout', actor: user.username, actor_id: user.id, ip_address: ipAddress })
  }

  const response = NextResponse.json({ ok: true })

  // Expire BOTH the __Host-mc-session cookie and the legacy mc-session cookie
  // so an HTTP→HTTPS transition cannot leave a live session after logout.
  response.cookies.set(MC_SESSION_COOKIE_NAME, '', {
    ...getMcSessionCookieOptions({ maxAgeSeconds: 0, isSecureRequest: true }),
  })
  response.cookies.set(LEGACY_MC_SESSION_COOKIE_NAME, '', {
    ...getMcSessionCookieOptions({ maxAgeSeconds: 0, isSecureRequest: false }),
  })

  return response
}
