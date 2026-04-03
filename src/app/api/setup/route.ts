import { NextRequest, NextResponse } from 'next/server'
import { needsFirstTimeSetup } from '@/lib/db'
import { createUser, createSession } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { getMcSessionCookieName, getMcSessionCookieOptions, isRequestSecure } from '@/lib/session-cookie'
import { loginLimiter, extractClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const INSECURE_PASSWORDS = new Set([
  'admin',
  'password',
  'change-me-on-first-login',
  'changeme',
  'testpass123',
])

export async function GET() {
  return NextResponse.json({ needsSetup: needsFirstTimeSetup() })
}

export async function POST(request: NextRequest) {
  // Rate-limit setup attempts — prevents brute-force of the setup window
  const rateCheck = loginLimiter(request)
  if (rateCheck) return rateCheck

  try {
    // Only allow setup when no users exist
    if (!needsFirstTimeSetup()) {
      return NextResponse.json(
        { error: 'Setup has already been completed' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { username, password, displayName } = body as {
      username?: string
      password?: string
      displayName?: string
    }

    // Validate username
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 })
    }
    const trimmedUsername = username.trim().toLowerCase()
    if (trimmedUsername.length < 2 || trimmedUsername.length > 64) {
      return NextResponse.json({ error: 'Username must be 2-64 characters' }, { status: 400 })
    }
    if (!/^[a-z0-9_.-]+$/.test(trimmedUsername)) {
      return NextResponse.json(
        { error: 'Username can only contain lowercase letters, numbers, dots, hyphens, and underscores' },
        { status: 400 }
      )
    }

    // Validate password
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 })
    }
    if (password.length < 12) {
      return NextResponse.json({ error: 'Password must be at least 12 characters' }, { status: 400 })
    }
    if (INSECURE_PASSWORDS.has(password)) {
      return NextResponse.json({ error: 'That password is too common. Choose a stronger one.' }, { status: 400 })
    }

    // Double-check no users exist (race safety — createUser will also fail on duplicate username)
    if (!needsFirstTimeSetup()) {
      return NextResponse.json(
        { error: 'Another admin was created while you were setting up' },
        { status: 409 }
      )
    }

    const resolvedDisplayName = displayName?.trim() ||
      trimmedUsername.charAt(0).toUpperCase() + trimmedUsername.slice(1)

    const user = createUser(trimmedUsername, password, resolvedDisplayName, 'admin')

    const ipAddress = extractClientIp(request)
    const userAgent = request.headers.get('user-agent') || undefined

    logAuditEvent({
      action: 'setup_admin_created',
      actor: user.username,
      actor_id: user.id,
      ip_address: ipAddress,
      user_agent: userAgent,
    })

    logger.info(`First-time setup: admin user "${user.username}" created`)

    // Auto-login: create session and set cookie
    const { token, expiresAt } = createSession(user.id, ipAddress, userAgent, user.workspace_id)

    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
      },
    })

    const isSecureRequest = isRequestSecure(request)
    const cookieName = getMcSessionCookieName(isSecureRequest)
    response.cookies.set(cookieName, token, {
      ...getMcSessionCookieOptions({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000), isSecureRequest }),
    })

    return response
  } catch (error) {
    logger.error({ err: error }, 'Setup error')
    return NextResponse.json({ error: 'Failed to create admin account' }, { status: 500 })
  }
}
