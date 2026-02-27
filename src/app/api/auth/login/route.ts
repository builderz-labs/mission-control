import { NextResponse } from 'next/server'
import { authenticateUser, createSession } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { getMcSessionCookieOptions } from '@/lib/session-cookie'
import { logger } from '@/lib/logger'

// Rate limiting: 5 attempts per minute per IP
const loginAttempts = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(ip)
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60_000 })
    return true
  }
  entry.count++
  return entry.count <= 5
}

export async function POST(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: 'Too many login attempts. Try again in a minute.' }, { status: 429 })
    }

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

    const { token, expiresAt } = createSession(user.id, ipAddress, userAgent)

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
      },
    })

    response.cookies.set('mc-session', token, {
      ...getMcSessionCookieOptions({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000) }),
    })

    return response
  } catch (error) {
    logger.error({ err: error }, 'Login error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
