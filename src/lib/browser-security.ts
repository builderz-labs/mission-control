function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase()
}

export function isLocalDashboardHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.endsWith('.local')
  )
}

export function shouldRedirectDashboardToHttps(input: {
  protocol: string
  hostname: string
  forceHttps?: boolean
}): boolean {
  if (!input.forceHttps) return false
  return input.protocol === 'http:' && !isLocalDashboardHost(input.hostname)
}

export function buildCanonicalHttpsRedirectUrl(input: {
  protocol: string
  hostname: string
  canonicalOrigin?: string | null
  pathname?: string
  search?: string
  method?: string
}): string | null {
  const method = String(input.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return null
  if (input.protocol !== 'http:') return null
  if (isLocalDashboardHost(input.hostname)) return null

  let canonical: URL
  try {
    canonical = new URL(String(input.canonicalOrigin || '').trim())
  } catch {
    return null
  }

  if (canonical.protocol !== 'https:') return null
  if (isLocalDashboardHost(canonical.hostname)) return null
  if (normalizeHostname(input.hostname) === normalizeHostname(canonical.hostname)) return null

  const pathname = String(input.pathname || '/')
  const target = new URL(pathname.startsWith('/') ? pathname : `/${pathname}`, canonical.origin)
  target.search = String(input.search || '')
  return target.toString()
}
