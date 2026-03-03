import { NextResponse } from 'next/server'
import { authenticateUser, createSession } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { getMcSessionCookieOptions } from '@/lib/session-cookie'
import { loginLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export async function POST(request: Request) {
  try {
    const rateCheck = loginLimiter(request)
    if (rateCheck) return rateCheck

    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
    }

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const userAgent = request.headers.get('user-agent') || undefined

    const user = authenticateUser(username, password)
    if (!user) {
      logAuditEvent({ action: 'login_failed', actor: username, ip_address: ipAddress, user_agent: userAgent })
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const { token, expiresAt } = createSession(user.id, ipAddress, userAgent, user.workspace_id)

    logAuditEvent({ action: 'login', actor: user.username, actor_id: user.id, ip_address: ipAddress, user_agent: userAgent })

    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        provider: user.provider || 'local',
        email: user.email || null,
        avatar_url: user.avatar_url || null,
        workspace_id: user.workspace_id ?? 1,
      },
    })

    const isSecureRequest = request.headers.get('x-forwarded-proto') === 'https'
      || new URL(request.url).protocol === 'https:'

    response.cookies.set('mc-session', token, {
      ...getMcSessionCookieOptions({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000), isSecureRequest }),
    })

    return response
  } catch (error) {
    logger.error({ err: error }, 'Login error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
