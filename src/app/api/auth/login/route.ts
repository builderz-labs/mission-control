import { NextResponse } from 'next/server'
import { authenticateUser, createSession } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'

export async function POST(request: Request) {
  try {
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
      },
    })

    response.cookies.set('mc-session', token, {
      httpOnly: true,
      secure: false, // No HTTPS on Tailscale
      sameSite: 'strict',
      maxAge: expiresAt - Math.floor(Date.now() / 1000),
      path: '/',
    })

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
