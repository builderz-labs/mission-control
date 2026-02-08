import { NextResponse } from 'next/server'
import { destroySession } from '@/lib/auth'

export async function POST(request: Request) {
  const cookieHeader = request.headers.get('cookie') || ''
  const match = cookieHeader.match(/(?:^|;\s*)mc-session=([^;]*)/)
  const token = match ? decodeURIComponent(match[1]) : null

  if (token) {
    destroySession(token)
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set('mc-session', '', {
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  })

  return response
}
