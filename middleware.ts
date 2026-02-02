import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Skip auth for API routes that need to be accessible
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // Verify API key for API routes
    const apiKey = request.headers.get('x-api-key')
    if (apiKey !== process.env.API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.next()
  }

  // Check for auth cookie
  const authCookie = request.cookies.get('mission-control-auth')
  if (authCookie?.value === process.env.AUTH_SECRET) {
    return NextResponse.next()
  }

  // Check basic auth header
  const authHeader = request.headers.get('authorization')
  if (authHeader) {
    const [scheme, encoded] = authHeader.split(' ')
    if (scheme === 'Basic') {
      const decoded = Buffer.from(encoded, 'base64').toString()
      const [user, pass] = decoded.split(':')
      
      if (user === process.env.AUTH_USER && pass === process.env.AUTH_PASS) {
        const response = NextResponse.next()
        // Set auth cookie for 7 days
        response.cookies.set('mission-control-auth', process.env.AUTH_SECRET!, {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          maxAge: 60 * 60 * 24 * 7
        })
        return response
      }
    }
  }

  // Request auth
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Mission Control"'
    }
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
