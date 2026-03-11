import crypto from 'node:crypto'
import os from 'node:os'
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

function normalizeHostname(raw: string): string {
  return raw.trim().replace(/^\[|\]$/g, '').split(':')[0].replace(/\.$/, '').toLowerCase()
}

function parseForwardedHost(forwarded: string | null): string[] {
  if (!forwarded) return []
  const hosts: string[] = []
  for (const part of forwarded.split(',')) {
    const match = /(?:^|;)\s*host="?([^";]+)"?/i.exec(part)
    if (match?.[1]) hosts.push(match[1])
  }
  return hosts
}

function getRequestHostCandidates(request: NextRequest): string[] {
  const rawCandidates = [
    ...(request.headers.get('x-forwarded-host') || '').split(','),
    ...(request.headers.get('x-original-host') || '').split(','),
    ...(request.headers.get('x-forwarded-server') || '').split(','),
    ...parseForwardedHost(request.headers.get('forwarded')),
    request.headers.get('host') || '',
    request.nextUrl.host || '',
    request.nextUrl.hostname || '',
  ]

  const candidates = rawCandidates
    .map(normalizeHostname)
    .filter(Boolean)

  return [...new Set(candidates)]
}

function getImplicitAllowedHosts(): string[] {
  const candidates = [
    'localhost',
    '127.0.0.1',
    '::1',
    normalizeHostname(os.hostname()),
  ].filter(Boolean)

  return [...new Set(candidates)]
}

function hostMatches(pattern: string, hostname: string): boolean {
  const p = normalizeHostname(pattern)
  const h = normalizeHostname(hostname)
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

function buildCsp(nonce: string, googleEnabled: boolean): string {
  return [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' blob:${googleEnabled ? ' https://accounts.google.com' : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    `connect-src 'self' ws: wss: http://127.0.0.1:* http://localhost:* https://cdn.jsdelivr.net`,
    `img-src 'self' data: blob:${googleEnabled ? ' https://*.googleusercontent.com https://lh3.googleusercontent.com' : ''}`,
    `font-src 'self' data:`,
    `frame-src 'self'${googleEnabled ? ' https://accounts.google.com' : ''}`,
    `worker-src 'self' blob:`,
  ].join('; ')
}

function nextResponseWithNonce(request: NextRequest): { response: NextResponse; nonce: string } {
  const nonce = crypto.randomBytes(16).toString('base64')
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
  return { response, nonce }
}

function addSecurityHeaders(response: NextResponse, _request: NextRequest, nonce?: string): NextResponse {
  const requestId = crypto.randomUUID()
  response.headers.set('X-Request-Id', requestId)
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  const googleEnabled = !!(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID)
  const effectiveNonce = nonce || crypto.randomBytes(16).toString('base64')
  response.headers.set('Content-Security-Policy', buildCsp(effectiveNonce, googleEnabled))

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
  const requestHosts = getRequestHostCandidates(request)
  const allowAnyHost = envFlag('MC_ALLOW_ANY_HOST') || process.env.NODE_ENV !== 'production'
  const allowedPatterns = String(process.env.MC_ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const implicitAllowedHosts = getImplicitAllowedHosts()

  const enforceAllowlist = !allowAnyHost && allowedPatterns.length > 0
  const isAllowedHost = !enforceAllowlist
    || requestHosts.some((hostName) =>
      implicitAllowedHosts.some((candidate) => hostMatches(candidate, hostName))
      || allowedPatterns.some((pattern) => hostMatches(pattern, hostName))
    )

  if (!isAllowedHost) {
    return addSecurityHeaders(new NextResponse('Forbidden', { status: 403 }), request)
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
        return addSecurityHeaders(NextResponse.json({ error: 'CSRF origin mismatch' }, { status: 403 }), request)
      }
    }
  }

  // Allow login page, auth API, and docs without session
  if (pathname === '/login' || pathname.startsWith('/api/auth/') || pathname === '/api/docs' || pathname === '/docs') {
    const { response, nonce } = nextResponseWithNonce(request)
    return addSecurityHeaders(response, request, nonce)
  }

  // Check for session cookie
  const sessionToken = request.cookies.get('mc-session')?.value

  // API routes: accept session cookie OR API key
  if (pathname.startsWith('/api/')) {
    const configuredApiKey = (process.env.API_KEY || '').trim()
    const apiKey = extractApiKeyFromRequest(request)
    const hasValidApiKey = Boolean(configuredApiKey && apiKey && safeCompare(apiKey, configuredApiKey))

    // Agent-scoped keys are validated in route auth (DB-backed) and should be
    // allowed to pass through proxy auth gate.
    const looksLikeAgentApiKey = /^mca_[a-f0-9]{48}$/i.test(apiKey)

    if (sessionToken || hasValidApiKey || looksLikeAgentApiKey) {
      const { response, nonce } = nextResponseWithNonce(request)
      return addSecurityHeaders(response, request, nonce)
    }

    return addSecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), request)
  }

  // Page routes: redirect to login if no session
  if (sessionToken) {
    const { response, nonce } = nextResponseWithNonce(request)
    return addSecurityHeaders(response, request, nonce)
  }

  // Redirect to login
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  return addSecurityHeaders(NextResponse.redirect(loginUrl), request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/).*)']
}
