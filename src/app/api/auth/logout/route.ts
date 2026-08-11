import { NextResponse } from 'next/server'
import { destroySession, getUserFromRequest } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import {
  expireAllMcSessionCookies,
  isRequestSecure,
  parseAllMcSessionCookieTokens,
} from '@/lib/session-cookie'

export async function POST(request: Request) {
  const user = getUserFromRequest(request)
  const cookieHeader = request.headers.get('cookie') || ''

  // Revoke every presented token (secure + legacy names can both be present).
  for (const token of parseAllMcSessionCookieTokens(cookieHeader)) {
    destroySession(token)
  }

  if (user) {
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({ action: 'logout', actor: user.username, actor_id: user.id, ip_address: ipAddress })
  }

  const response = NextResponse.json({ ok: true })
  expireAllMcSessionCookies(response, isRequestSecure(request))

  return response
}
