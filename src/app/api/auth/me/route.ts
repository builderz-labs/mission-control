import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, updateUser, requireRole, destroyAllUserSessions, createSession } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { verifyPassword } from '@/lib/password'
import { getMcSessionCookieName, getMcSessionCookieOptions, isRequestSecure } from '@/lib/session-cookie'
import { logger } from '@/lib/logger'

export async function GET(request: Request) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const user = getUserFromRequest(request)

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      provider: user.provider || 'local',
      email: user.email || null,
      avatar_url: user.avatar_url || null,
      workspace_id: user.workspace_id ?? 1,
      tenant_id: user.tenant_id ?? 1,
    },
  })
}

/**
 * PATCH /api/auth/me - Self-service password change and display name update.
 * Body: { current_password, new_password } and/or { display_name }
 */
export async function PATCH(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // API key users (id=0) cannot change passwords
  if (user.id === 0) {
    return NextResponse.json({ error: 'API key users cannot change passwords' }, { status: 403 })
  }

  try {
    const { current_password, new_password, display_name } = await request.json()

    const updates: { password?: string; display_name?: string } = {}

    // Handle password change
    if (new_password) {
      if (!current_password) {
        return NextResponse.json({ error: 'Current password is required' }, { status: 400 })
      }

      if (new_password.length < 8) {
        return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 })
      }

      // Verify current password by fetching stored hash
      const { getDatabase } = await import('@/lib/db')
      const db = getDatabase()
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as any
      if (!row || !verifyPassword(current_password, row.password_hash)) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 })
      }

      updates.password = new_password
    }

    // Handle display name update
    if (display_name !== undefined) {
      if (!display_name.trim()) {
        return NextResponse.json({ error: 'Display name cannot be empty' }, { status: 400 })
      }
      updates.display_name = display_name.trim()
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    const updated = updateUser(user.id, updates)
    if (!updated) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const userAgent = request.headers.get('user-agent') || undefined
    if (updates.password) {
      logAuditEvent({ action: 'password_change', actor: user.username, actor_id: user.id, ip_address: ipAddress })
      // Revoke all existing sessions and issue a fresh one for this request
      destroyAllUserSessions(user.id)
    }
    if (updates.display_name) {
      logAuditEvent({ action: 'profile_update', actor: user.username, actor_id: user.id, detail: { display_name: updates.display_name }, ip_address: ipAddress })
    }

    const response = NextResponse.json({
      success: true,
      user: {
        id: updated.id,
        username: updated.username,
        display_name: updated.display_name,
        role: updated.role,
        provider: updated.provider || 'local',
        email: updated.email || null,
        avatar_url: updated.avatar_url || null,
        workspace_id: updated.workspace_id ?? 1,
        tenant_id: updated.tenant_id ?? 1,
      },
    })

    // Issue a fresh session cookie after password change (old ones were just revoked)
    if (updates.password) {
      const { token, expiresAt } = createSession(user.id, ipAddress, userAgent, user.workspace_id ?? 1)
      const isSecureRequest = isRequestSecure(request)
      const cookieName = getMcSessionCookieName(isSecureRequest)
      response.cookies.set(cookieName, token, {
        ...getMcSessionCookieOptions({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000), isSecureRequest }),
      })
    }

    return response
  } catch (error) {
    logger.error({ err: error }, 'PATCH /api/auth/me error')
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
