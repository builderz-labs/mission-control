/**
 * Loopback auto-login decisions. The route handler owns the reachability
 * probe, token consumption, and session creation because it runs on Node.
 */

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on'])
const SAFE_NAVIGATION_SITES = new Set(['none', 'same-origin'])

export const AUTO_LOGIN_TOKEN_FILE = 'auto-login-token.json'

export function isAutoLoginEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return ENABLED_VALUES.has(String(env.MC_AUTO_LOGIN ?? '').trim().toLowerCase())
}

/**
 * A top-level browser navigation arrives as `none`; internal same-origin
 * navigation is `same-origin`. Missing or cross-site values fail closed.
 */
export function isAllowedAutoLoginNavigation(secFetchSite: string | null | undefined): boolean {
  if (typeof secFetchSite !== 'string') return false
  return SAFE_NAVIGATION_SITES.has(secFetchSite.trim().toLowerCase())
}

function hostnameFromHeader(hostHeader: string): string {
  const trimmed = hostHeader.trim().toLowerCase()
  if (!trimmed) return ''
  const bracketed = trimmed.match(/^\[([^\]]*)\](?::\d*)?$/)
  if (bracketed) return bracketed[1]
  // A bare IPv6 host needs no port stripping, and splitting it on ':' would
  // shred the address; HTTP only sends the bracketed form when a port follows.
  if ((trimmed.match(/:/g) ?? []).length > 1) return trimmed
  const lastColon = trimmed.lastIndexOf(':')
  if (lastColon > -1 && /^\d*$/.test(trimmed.slice(lastColon + 1))) {
    return trimmed.slice(0, lastColon)
  }
  return trimmed
}

function isLoopbackIpv4(hostname: string): boolean {
  const octets = hostname.split('.')
  if (octets.length !== 4 || octets[0] !== '127') return false
  return octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
}

export function isLoopbackHostHeader(hostHeader: string | null | undefined): boolean {
  if (!hostHeader) return false
  const hostname = hostnameFromHeader(hostHeader)
  if (!hostname) return false
  return hostname === 'localhost' || hostname === '::1' || isLoopbackIpv4(hostname)
}

export function portFromUrl(rawUrl: string): number | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.port) {
    const port = Number(url.port)
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null
  }
  if (url.protocol === 'http:') return 80
  if (url.protocol === 'https:') return 443
  return null
}

const AUTO_LOGIN_BASE = 'http://127.0.0.1'

/**
 * Only same-origin absolute paths survive: `//host` and `/\host` both change
 * origin when a browser resolves them, so a plain prefix check is not enough.
 */
export function safeAutoLoginTarget(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0) return '/'
  if (!raw.startsWith('/')) return '/'
  let resolved: URL
  try {
    resolved = new URL(raw, AUTO_LOGIN_BASE)
  } catch {
    return '/'
  }
  if (resolved.origin !== AUTO_LOGIN_BASE || !resolved.pathname.startsWith('/')) return '/'
  return raw
}
