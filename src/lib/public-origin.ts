/**
 * Resolve the browser-visible origin of a request.
 *
 * Forwarded headers are untrusted input by default. They are considered only
 * when MC_TRUSTED_PROXY_HEADERS=1 and MC_TRUSTED_PROXY_IPS is set. The
 * transport adapter must also expose the actual peer IP (NextRequest.ip).
 * Operators should configure their proxy to overwrite, rather than append to,
 * the forwarding headers at the network boundary.
 */

export type PublicOrigin = { protocol: 'http:' | 'https:'; host: string; origin: string }

function envList(...names: string[]): string[] {
  for (const name of names) {
    const value = String(process.env[name] || '').trim()
    if (value) return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function normalizeHost(value: string): string {
  return value.trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
}

const MAX_HEADER_LENGTH = 4096

function validHeader(value: string): boolean {
  return value.length <= MAX_HEADER_LENGTH && !/[\u0000-\u001f\u007f]/.test(value)
}

function matchesTrusted(value: string, trusted: string[]): boolean {
  const normalized = normalizeHost(value)
  return Boolean(normalized && trusted.some((candidate) => {
    const pattern = normalizeHost(candidate)
    if (!pattern) return false
    if (pattern.endsWith('.*')) return normalized.startsWith(pattern.slice(0, -1))
    return normalized === pattern
  }))
}

function trustedForwardedRequest(request: Request): boolean {
  if (String(process.env.MC_TRUSTED_PROXY_HEADERS || '').trim().toLowerCase() !== '1') return false
  const trusted = envList('MC_TRUSTED_PROXY_IPS', 'MC_PROXY_TRUSTED_IPS')
  if (!trusted.length) return false
  // NextRequest may expose the actual peer address. When available, require
  // it to be trusted; this prevents a direct client from forging the XFF chain.
  const peerIp = (request as Request & { ip?: string }).ip?.trim()
  if (!peerIp || !matchesTrusted(peerIp, trusted)) return false
  const xff = request.headers.get('x-forwarded-for') || ''
  if (!validHeader(xff)) return false
  const hops = xff.split(',').map((item) => item.trim()).filter(Boolean)
  // The nearest proxy is the right-most XFF hop. A configured proxy must be
  // present there before any forwarded origin data is used.
  return hops.length > 0 && matchesTrusted(hops[hops.length - 1], trusted)
}

function firstForwardedValue(value: string | null): string {
  return String(value || '').split(',')[0]?.trim() || ''
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
      const direct = parseOrigin(request.url)
      return direct || { protocol: 'http:', host: 'localhost', origin: 'http://localhost' }
    }
    const host = forwardedHost(request)
    const forwardedProto = request.headers.get('x-forwarded-proto') || ''
    const forwardedPort = request.headers.get('x-forwarded-port') || ''
    if (!validHeader(forwardedProto) || !validHeader(forwardedPort)) return parseOrigin(request.url) || { protocol: 'http:', host: 'localhost', origin: 'http://localhost' }
    const protocol = (forwardedParameter(request, 'proto') || nearestForwardedValue(forwardedProto)).toLowerCase()
    if (host && (protocol === 'http' || protocol === 'https')) {
      const port = forwardedParameter(request, 'port') || nearestForwardedValue(forwardedPort)
      const hostWithPort = port && !host.includes(':') && !host.endsWith(`:${port}`) ? `${host}:${port}` : host
      const resolved = parseOrigin(`${protocol}://${hostWithPort}`)
      if (resolved) return resolved
    }
  }

  const direct = parseOrigin(request.url)
  return direct || { protocol: 'http:', host: 'localhost', origin: 'http://localhost' }
}

export function isRequestSecureWithTrust(request: Request): boolean {
  return resolvePublicOrigin(request).protocol === 'https:'
}

export function publicOriginHostCandidates(request: Request): string[] {
  const result = new Set<string>()
  const direct = parseOrigin(request.url)
  // Do not expose the localhost fallback as a host candidate when a malformed
  // test adapter or framework wrapper has no usable request URL.
  if (direct) result.add(normalizeHost(resolvePublicOrigin(request).host))
  else {
    const configured = configuredPublicOrigin()
    if (configured) result.add(normalizeHost(configured.host))
  }
  return [...result].filter(Boolean)
}

export function isTrustedForwardedRequest(request: Request): boolean {
  return trustedForwardedRequest(request)
}
