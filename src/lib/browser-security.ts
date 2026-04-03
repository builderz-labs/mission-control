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
