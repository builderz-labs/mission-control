import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/** Constant-time string comparison using Node.js crypto. */
function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function envFlag(name: string): boolean {
  const raw = process.env[name]
  if (raw === undefined) return false
  const v = String(raw).trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function getRequestHostname(request: NextRequest): string {
  const raw = request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
  // If multiple hosts are present, take the first (proxy chain).
  const first = raw.split(',')[0] || ''
  return first.trim().split(':')[0] || ''
}

function hostMatches(pattern: string, hostname: string): boolean {
  const p = pattern.trim().toLowerCase()
  const h = hostname.trim().toLowerCase()
  if (!p || !h) return false

  // "*.example.com" matches "a.example.com" (but not bare "example.com")
  if (p.startsWith('*.')) {
    const suffix = p.slice(2)
    return h.endsWith(`.${suffix}`)
  }

  // "100.*" matches "100.64.0.1"
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
  return response
}

function extractApiKeyFromRequest(request: NextRequest): string {
  const direct = (request.headers.get('x-api-key') || '').trim()
  if (direct) return direct

  const authorization = (request.headers.get('authorization') || '').trim()
  if (!authorization) return ''

  const [scheme, ...rest] = authorization.split(/\s+/)
  if (!scheme || rest.length === 0) return ''
  const normalized = scheme.toLowerCase()
  if (normalized === 'bearer' || normalized === 'apikey' || normalized === 'token') {
    return rest.join(' ').trim()
  }
  return ''
}

export function proxy(request: NextRequest) {
  // Network access control.
  // In production: default-deny unless explicitly allowed.
  // In dev/test: allow all hosts unless overridden.
  const hostName = getRequestHostname(request)
  const allowAnyHost = envFlag('MC_ALLOW_ANY_HOST') || process.env.NODE_ENV !== 'production'
  const allowedPatterns = String(process.env.MC_ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const enforceAllowlist = !allowAnyHost && allowedPatterns.length > 0
  const isAllowedHost = !enforceAllowlist || allowedPatterns.some((p) => hostMatches(p, hostName))

  if (!isAllowedHost) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const { pathname } = request.nextUrl

  // CSRF Origin validation for mutating requests
  const method = request.method.toUpperCase()
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const origin = request.headers.get('origin')
    if (origin) {
      let originHost: string
      try { originHost = new URL(origin).host } catch { originHost = '' }
      const requestHost = request.headers.get('host')?.split(',')[0]?.trim()
        || request.nextUrl.host
        || ''
      if (originHost && requestHost && originHost !== requestHost) {
        return NextResponse.json({ error: 'CSRF origin mismatch' }, { status: 403 })
      }
    }
  }

  // Allow login page, auth API, and docs without session
  if (pathname === '/login' || pathname.startsWith('/api/auth/') || pathname === '/api/docs' || pathname === '/docs') {
    return applySecurityHeaders(NextResponse.next())
  }

  // Check for session cookie
  const sessionToken = request.cookies.get('mc-session')?.value

  // API routes: accept session cookie OR API key
  if (pathname.startsWith('/api/')) {
    const configuredApiKey = (process.env.API_KEY || '').trim()
    const apiKey = extractApiKeyFromRequest(request)
    const hasValidApiKey = Boolean(configuredApiKey && apiKey && safeCompare(apiKey, configuredApiKey))
    // Dedicated agent API keys are validated in route auth against DB.
    // Proxy only permits them to pass through to avoid coupling middleware to DB access.
    const hasAgentApiKeyCandidate = apiKey.startsWith('mca_')
    if (sessionToken || hasValidApiKey || hasAgentApiKeyCandidate) {
      return applySecurityHeaders(NextResponse.next())
    }

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Page routes: redirect to login if no session
  if (sessionToken) {
    return applySecurityHeaders(NextResponse.next())
  }

  // Redirect to login
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
