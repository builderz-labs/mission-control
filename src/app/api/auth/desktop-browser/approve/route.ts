import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { approveDesktopBrowserLogin, isDesktopUserSession } from '@/lib/desktop-browser-login'
import { logAuditEvent } from '@/lib/db'
import { desktopBrowserApprovalLimiter, extractClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export async function POST(request: Request) {
  const user = getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!isDesktopUserSession(user)) {
    return NextResponse.json({
      error: 'Approve this code from the Mission Control desktop app',
      code: 'DESKTOP_SESSION_REQUIRED',
    }, { status: 403 })
  }
  const rateCheck = desktopBrowserApprovalLimiter(String(user.id))
  if (rateCheck) return rateCheck

  let body: { code?: unknown }
  try {
    body = await request.json() as { code?: unknown }
  } catch {
    return NextResponse.json({ error: 'A sign-in code is required' }, { status: 400 })
  }

  try {
    if (!approveDesktopBrowserLogin(body.code, user)) {
      return NextResponse.json({
        error: 'That sign-in code is invalid or expired',
        code: 'INVALID_OR_EXPIRED_CODE',
      }, { status: 400 })
    }
    logAuditEvent({
      action: 'desktop_browser_login_approved', actor: user.username,
      actor_id: user.id, ip_address: extractClientIp(request),
    })
    return NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logger.error({ err: error }, 'Desktop browser login approval failed')
    return NextResponse.json({ error: 'Could not approve browser sign-in' }, { status: 500 })
  }
}
