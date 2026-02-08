import { NextResponse } from 'next/server'
import { authenticateUser, createSession } from '@/lib/auth'

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
    }

    const user = authenticateUser(username, password)
    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const userAgent = request.headers.get('user-agent') || undefined

    const { token, expiresAt } = createSession(user.id, ipAddress, userAgent)

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
