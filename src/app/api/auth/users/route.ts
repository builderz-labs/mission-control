import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, getAllUsers, createUser, updateUser, deleteUser } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'

/**
 * GET /api/auth/users - List all users (admin only)
 */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const users = getAllUsers()
  return NextResponse.json({ users })
}

/**
 * POST /api/auth/users - Create a new user (admin only)
 */
export async function POST(request: NextRequest) {
  const currentUser = getUserFromRequest(request)
  if (!currentUser || currentUser.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const { username, password, display_name, role = 'operator' } = await request.json()

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
    }

    if (!['admin', 'operator', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    const newUser = createUser(username, password, display_name || username, role)

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'user_create', actor: currentUser.username, actor_id: currentUser.id,
      target_type: 'user', target_id: newUser.id,
      detail: { username, role }, ip_address: ipAddress,
    })

    return NextResponse.json({
      user: {
        id: newUser.id,
        username: newUser.username,
        display_name: newUser.display_name,
        role: newUser.role,
      }
    }, { status: 201 })
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint failed')) {
      return NextResponse.json({ error: 'Username already exists' }, { status: 409 })
    }
    console.error('POST /api/auth/users error:', error)
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}

/**
 * PUT /api/auth/users - Update a user (admin only)
 */
export async function PUT(request: NextRequest) {
  const currentUser = getUserFromRequest(request)
  if (!currentUser || currentUser.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const { id, display_name, role, password } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    if (role && !['admin', 'operator', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    // Prevent demoting yourself
    if (id === currentUser.id && role && role !== currentUser.role) {
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 })
    }

    const updated = updateUser(id, { display_name, role, password: password || undefined })
    if (!updated) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'user_update', actor: currentUser.username, actor_id: currentUser.id,
      target_type: 'user', target_id: id,
      detail: { display_name, role, password_changed: !!password }, ip_address: ipAddress,
    })

    return NextResponse.json({
      user: {
        id: updated.id,
        username: updated.username,
        display_name: updated.display_name,
        role: updated.role,
      }
    })
  } catch (error) {
    console.error('PUT /api/auth/users error:', error)
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}

/**
 * DELETE /api/auth/users - Delete a user (admin only)
 */
export async function DELETE(request: NextRequest) {
  const currentUser = getUserFromRequest(request)
  if (!currentUser || currentUser.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
  }

  const userId = parseInt(id)

  // Prevent deleting yourself
  if (userId === currentUser.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
  }

  const deleted = deleteUser(userId)
  if (!deleted) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'user_delete', actor: currentUser.username, actor_id: currentUser.id,
    target_type: 'user', target_id: userId,
    ip_address: ipAddress,
  })

  return NextResponse.json({ success: true })
}
