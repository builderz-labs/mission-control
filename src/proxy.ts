import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/** Edge-compatible constant-time string comparison. */
function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const encoder = new TextEncoder()
  const bufA = encoder.encode(a)
  const bufB = encoder.encode(b)
  if (bufA.length !== bufB.length) return false
  let result = 0
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i]
  }
  return result === 0
}

function envFlag(name: string): boolean {
  const raw = process.env[name]
  if (raw === undefined) return false
  const v = String(raw).trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function getRequestHostname(request: NextRequest): string {
  const raw = request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
  const first = raw.split(',')[0] || ''
  return first.trim().split(':')[0] || ''
}

function hostMatches(pattern: string, hostname: string): boolean {
  const p = pattern.trim().toLowerCase()
  const h = hostname.trim().toLowerCase()
  if (!p || !h) return false

  if (p.startsWith('*.')) {
    const suffix = p.slice(2)
    return h.endsWith(`.${suffix}`)
  }

  if (p.endsWith('.*')) {
    const prefix = p.slice(0, -1)
    return h.startsWith(prefix)
  }

  return h === p
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' ws: wss:",
      "font-src 'self' data:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  )
  return response
}

export function proxy(request: NextRequest) {
  const hostName = getRequestHostname(request)
  const allowAnyHost = envFlag('MC_ALLOW_ANY_HOST') || process.env.NODE_ENV !== 'production'
  const allowedPatterns = String(process.env.MC_ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const isAllowedHost = allowAnyHost || allowedPatterns.some((p) => hostMatches(p, hostName))

  if (!isAllowedHost) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const { pathname } = request.nextUrl
  const method = request.method.toUpperCase()

  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const origin = request.headers.get('origin')
    if (origin) {
      let originHost = ''
      try {
        originHost = new URL(origin).host
      } catch {
        originHost = ''
      }
      const requestHost = request.headers.get('host')?.split(',')[0]?.trim()
        || request.nextUrl.host
        || ''
      if (originHost && requestHost && originHost !== requestHost) {
        return NextResponse.json({ error: 'CSRF origin mismatch' }, { status: 403 })
      }
    }
  }

  if (envFlag('MC_DISABLE_AUTH')) {
    return applySecurityHeaders(NextResponse.next())
  }

  if (pathname === '/login' || pathname.startsWith('/api/auth/') || pathname === '/api/docs' || pathname === '/docs') {
    return applySecurityHeaders(NextResponse.next())
  }

  const sessionToken = request.cookies.get('mc-session')?.value

  if (pathname.startsWith('/api/')) {
    const apiKey = request.headers.get('x-api-key')
    if (sessionToken || (apiKey && safeCompare(apiKey, process.env.API_KEY || ''))) {
      return applySecurityHeaders(NextResponse.next())
    }

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (sessionToken) {
    return applySecurityHeaders(NextResponse.next())
  }

  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)']
}
