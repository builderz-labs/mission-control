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

  const { pathname } = request.nextUrl

  // Allow login page and auth API without session
  if (pathname === '/login' || pathname.startsWith('/api/auth/')) {
    return NextResponse.next()
  }

  // Check for session cookie
  const sessionToken = request.cookies.get('mc-session')?.value

  // API routes: accept session cookie OR API key
  if (pathname.startsWith('/api/')) {
    const apiKey = request.headers.get('x-api-key')
    if (sessionToken || (apiKey && apiKey === process.env.API_KEY)) {
      return NextResponse.next()
    }

    // Backward compat: accept legacy cookie during migration
    const legacyCookie = request.cookies.get('mission-control-auth')
    if (legacyCookie?.value === process.env.AUTH_SECRET) {
      return NextResponse.next()
    }

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Page routes: redirect to login if no session
  if (sessionToken) {
    return NextResponse.next()
  }

  // Backward compat: accept legacy cookie
  const legacyCookie = request.cookies.get('mission-control-auth')
  if (legacyCookie?.value === process.env.AUTH_SECRET) {
    return NextResponse.next()
  }

  // Redirect to login
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
