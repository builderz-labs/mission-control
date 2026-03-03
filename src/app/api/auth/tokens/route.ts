import { NextRequest, NextResponse } from 'next/server'
import { requireRole, createApiToken, listApiTokens, revokeApiToken, rotateApiToken } from '@/lib/auth'

/**
 * GET /api/auth/tokens - List all API tokens (metadata only)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const tokens = listApiTokens()
    return NextResponse.json({ tokens })
  } catch (error) {
    console.error('GET /api/auth/tokens error:', error)
    return NextResponse.json({ error: 'Failed to list tokens' }, { status: 500 })
  }
}

/**
 * POST /api/auth/tokens - Create a new API token
 * Body: { name, role?, expires_in_days? }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { name, role, expires_in_days } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const validRoles = ['admin', 'operator', 'viewer']
    const tokenRole = validRoles.includes(role) ? role : 'operator'

    const result = createApiToken(
      name.trim(),
      tokenRole,
      auth.user.username,
      expires_in_days && expires_in_days > 0 ? expires_in_days : undefined
    )

    return NextResponse.json({
      token: result.token,
      prefix: result.prefix,
      id: result.id,
      expires_at: result.expiresAt,
      message: 'Save this token now — it will not be shown again.',
    }, { status: 201 })
  } catch (error) {
    console.error('POST /api/auth/tokens error:', error)
    return NextResponse.json({ error: 'Failed to create token' }, { status: 500 })
  }
}

/**
 * PUT /api/auth/tokens - Rotate or revoke a token
 * Body: { id, action: 'rotate' | 'revoke' }
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { id, action } = body

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    if (action === 'revoke') {
      const revoked = revokeApiToken(id)
      if (!revoked) return NextResponse.json({ error: 'Token not found or already revoked' }, { status: 404 })
      return NextResponse.json({ success: true, message: 'Token revoked' })
    }

    if (action === 'rotate') {
      const result = rotateApiToken(id, auth.user.username)
      if (!result) return NextResponse.json({ error: 'Token not found' }, { status: 404 })
      return NextResponse.json({
        token: result.token,
        prefix: result.prefix,
        new_id: result.newId,
        expires_at: result.expiresAt,
        message: 'Old token revoked. Save the new token now — it will not be shown again.',
      })
    }

    return NextResponse.json({ error: 'action must be "rotate" or "revoke"' }, { status: 400 })
  } catch (error) {
    console.error('PUT /api/auth/tokens error:', error)
    return NextResponse.json({ error: 'Failed to update token' }, { status: 500 })
  }
}
