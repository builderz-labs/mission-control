import { NextResponse } from 'next/server'
import { createSession, getUserById } from '@/lib/auth'
import { consumeDesktopBrowserLogin } from '@/lib/desktop-browser-login'
import { logAuditEvent } from '@/lib/db'
import { desktopBrowserPollLimiter, extractClientIp } from '@/lib/rate-limit'
import { getMcSessionCookieName, getMcSessionCookieOptions, isRequestSecure } from '@/lib/session-cookie'
import { logger } from '@/lib/logger'

export async function POST(request: Request) {
  const rateCheck = desktopBrowserPollLimiter(request)
  if (rateCheck) return rateCheck
  let body: { request_id?: unknown }
  try {
    body = await request.json() as { request_id?: unknown }
  } catch {
    return NextResponse.json({ error: 'A sign-in request is required' }, { status: 400 })
  }

  try {
    const result = consumeDesktopBrowserLogin(body.request_id)
    if (result.status === 'pending') {
      return NextResponse.json(
        { status: 'pending', expires_at: result.expiresAt },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (result.status === 'expired') {
      return NextResponse.json({ error: 'Sign-in code expired', code: 'CODE_EXPIRED' }, { status: 410 })
    }
    if (result.status === 'invalid') {
      return NextResponse.json({ error: 'Sign-in request not found' }, { status: 404 })
    }

    const user = getUserById(result.userId)
    if (!user || user.workspace_id !== result.workspaceId || user.tenant_id !== result.tenantId) {
      return NextResponse.json({ error: 'Approved account is unavailable' }, { status: 403 })
    }
    const ipAddress = extractClientIp(request)
    const userAgent = request.headers.get('user-agent') || undefined
    const { token, expiresAt } = createSession(user.id, ipAddress, userAgent, result.workspaceId)
    logAuditEvent({
      action: 'login_desktop_browser', actor: user.username,
      actor_id: user.id, ip_address: ipAddress, user_agent: userAgent,
    })

    const response = NextResponse.json({ status: 'approved' }, { headers: { 'Cache-Control': 'no-store' } })
    const secure = isRequestSecure(request)
    response.cookies.set(getMcSessionCookieName(secure), token, {
      ...getMcSessionCookieOptions({
        maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000),
        isSecureRequest: secure,
      }),
    })
    return response
  } catch (error) {
    logger.error({ err: error }, 'Desktop browser login poll failed')
    return NextResponse.json({ error: 'Could not complete browser sign-in' }, { status: 500 })
  }
}
