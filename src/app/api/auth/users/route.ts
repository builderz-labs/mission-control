import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest, getAllUsers, createUser } from '@/lib/auth'

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
