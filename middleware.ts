import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Allow localhost and Tailscale (100.x.x.x / *.ts.net) connections only
  const host = request.headers.get('host') || ''
  const hostName = host.split(':')[0]
  const isLocalhost = hostName === 'localhost' || hostName === '127.0.0.1'
  const isTailscale = hostName.startsWith('100.') || hostName.endsWith('.ts.net')

  if (!isLocalhost && !isTailscale) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // API routes: accept API key header OR auth cookie
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const apiKey = request.headers.get('x-api-key')
    const authCookie = request.cookies.get('mission-control-auth')
    if (apiKey === process.env.API_KEY || authCookie?.value === process.env.AUTH_SECRET) {
      return NextResponse.next()
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
        response.cookies.set('mission-control-auth', process.env.AUTH_SECRET!, {
          httpOnly: true,
          secure: false, // no HTTPS on Tailscale
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
