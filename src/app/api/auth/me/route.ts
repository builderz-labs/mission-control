import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'

export async function GET(request: Request) {
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
    },
  })
}
