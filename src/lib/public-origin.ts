/**
 * Resolve the browser-visible origin of a request.
 *
 * Forwarded headers are untrusted input by default. They are considered only
 * when MC_TRUSTED_PROXY_HEADERS=1 and the request carries the configured
 * proxy secret. Next.js does not expose a reliable transport peer IP here,
 * so X-Forwarded-For is never used to establish trust.
 * Operators should configure their proxy to overwrite, rather than append to,
 * the forwarding headers at the network boundary.
 */

export type PublicOrigin = { protocol: 'http:' | 'https:'; host: string; origin: string }

function normalizeHost(value: unknown): string {
  return String(value || '').trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
}

const MAX_HEADER_LENGTH = 4096

function validHeader(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_HEADER_LENGTH && !/[\u0000-\u001f\u007f]/.test(value)
}

function trustedForwardedRequest(request: Request): boolean {
  if (String(process.env.MC_TRUSTED_PROXY_HEADERS || '').trim().toLowerCase() !== '1') return false
  const secret = String(process.env.MC_PROXY_HEADER_SECRET || '')
  const suppliedSecret = request.headers?.get?.('x-mission-control-proxy-secret') || ''
  return Boolean(secret && constantTimeEqual(suppliedSecret, secret))
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  let diff = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) diff |= (left[i % (left.length || 1)] || 0) ^ (right[i % (right.length || 1)] || 0)
  return diff === 0
}

function nearestForwardedValue(value: string | null): string {
  const values = String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
  return values[values.length - 1] || ''
}

function forwardedHost(request: Request): string {
  const forwarded = nearestForwardedValue(request.headers.get('forwarded'))
  const fromStandard = /(?:^|;)\s*host="?([^";]+)"?/i.exec(forwarded)?.[1] || ''
  return fromStandard || nearestForwardedValue(request.headers.get('x-forwarded-host'))
}

function forwardedParameter(request: Request, name: string): string {
  const value = nearestForwardedValue(request.headers.get('forwarded'))
  return new RegExp(`(?:^|;)\\s*${name}="?([^";]+)"?`, 'i').exec(value)?.[1]?.trim() || ''
}

function parseOrigin(value: string): PublicOrigin | null {
  if (!validHeader(value)) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (!parsed.host || parsed.username || parsed.password) return null
    return { protocol: parsed.protocol, host: parsed.host.toLowerCase(), origin: parsed.origin }
  } catch {
    return null
  }
}

export function configuredPublicOrigin(): PublicOrigin | null {
  return parseOrigin(
    String(process.env.MC_PUBLIC_URL || process.env.MC_PUBLIC_BASE_URL || process.env.MISSION_CONTROL_PUBLIC_URL || '').trim(),
  )
}

export function resolvePublicOrigin(request: Request): PublicOrigin {
  const configured = configuredPublicOrigin()
  if (configured) return configured

  if (trustedForwardedRequest(request)) {
    const forwardedHeader = request.headers.get('forwarded') || ''
    const forwardedHostHeader = request.headers.get('x-forwarded-host') || ''
    if (!validHeader(forwardedHeader) || !validHeader(forwardedHostHeader)) {
      const direct = parseOrigin(request?.url)
      return direct || { protocol: 'http:', host: 'localhost', origin: 'http://localhost' }
    }
    const host = forwardedHost(request)
    const forwardedProto = request.headers.get('x-forwarded-proto') || ''
    const forwardedPort = request.headers.get('x-forwarded-port') || ''
    if (!validHeader(forwardedProto) || !validHeader(forwardedPort)) return parseOrigin(request?.url) || { protocol: 'http:', host: 'localhost', origin: 'http://localhost' }
    const protocol = (forwardedParameter(request, 'proto') || nearestForwardedValue(forwardedProto)).toLowerCase()
    if (host && (protocol === 'http' || protocol === 'https')) {
      const port = forwardedParameter(request, 'port') || nearestForwardedValue(forwardedPort)
      const hostWithPort = port && !host.includes(':') && !host.endsWith(`:${port}`) ? `${host}:${port}` : host
      const resolved = parseOrigin(`${protocol}://${hostWithPort}`)
      if (resolved) return resolved
    }
  }

  const direct = parseOrigin(request?.url)
  return direct || { protocol: 'http:', host: 'localhost', origin: 'http://localhost' }
}

export function isRequestSecureWithTrust(request: Request): boolean {
  return resolvePublicOrigin(request).protocol === 'https:'
}

export function publicOriginHostCandidates(request: Request): string[] {
  // The configured public URL is deliberately not an observed host. Otherwise
  // a direct request for evil.example would pass an allowlist for mc.example.
  if (trustedForwardedRequest(request)) {
    const forwarded = normalizeHost(forwardedHost(request))
    // Once a proxy has authenticated its headers, its public host is the only
    // observed host. Mixing in Host or nextUrl would let a client-controlled
    // direct host satisfy the allowlist instead.
    return forwarded ? [forwarded] : []
  }
  const direct = parseOrigin(request?.url)
  return direct ? [normalizeHost(direct.host)].filter(Boolean) : []
}

export function isTrustedForwardedRequest(request: Request): boolean {
  return trustedForwardedRequest(request)
}
