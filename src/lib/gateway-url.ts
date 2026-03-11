function normalizeGatewayPath(value?: string): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const withoutTrailing = withLeadingSlash.replace(/\/+$/, '')
  return withoutTrailing === '/' ? '' : withoutTrailing
}

function stripPathFromHost(host: string): { host: string; path: string } {
  const [hostPart, ...rest] = host.split('/')
  const sanitizedHost = (hostPart || '').trim()
  const path = rest.length ? normalizeGatewayPath('/' + rest.join('/')) : ''
  return { host: sanitizedHost, path }
}

function stripPortForLocalCheck(host: string): string {
  if (!host) return ''
  const lower = host.toLowerCase()
  if (lower.startsWith('[')) {
    const closing = lower.indexOf(']')
    if (closing > -1) return lower.slice(1, closing)
    return lower
  }
  const colonIndex = lower.lastIndexOf(':')
  if (colonIndex > -1 && lower.indexOf(':') === colonIndex) {
    const portCandidate = lower.slice(colonIndex + 1)
    if (/^\d+$/.test(portCandidate)) {
      return lower.slice(0, colonIndex)
    }
  }
  return lower
}

function isLocalHost(host: string): boolean {
  const normalized = stripPortForLocalCheck(host)
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.local') ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  )
}

function formatHostForUrl(host: string): string {
  if (!host) return host
  const trimmed = host.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed
  const colonCount = (trimmed.match(/:/g) || []).length
  if (colonCount > 1 && !trimmed.startsWith('[')) {
    return `[${trimmed}]`
  }
  return trimmed
}

function appendPath(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.replace(/\/$/, '')
  if (!path) return trimmedBase
  return `${trimmedBase}${path}`
}

function normalizeProtocol(protocol: string): 'ws:' | 'wss:' {
  if (protocol === 'https:' || protocol === 'wss:') return 'wss:'
  return 'ws:'
}

export function buildGatewayWebSocketUrl(input: {
  host: string
  port: number
  browserProtocol?: string
  path?: string
}): string {
  const rawHost = String(input.host || '').trim()
  const port = Number(input.port)
  const browserProtocol = input.browserProtocol === 'https:' ? 'https:' : 'http:'
  const explicitPath = normalizeGatewayPath(input.path)

  if (!rawHost) {
    const base = `${browserProtocol === 'https:' ? 'wss' : 'ws'}://127.0.0.1:${port || 18789}`
    return appendPath(base, explicitPath)
  }

  const prefixed =
    rawHost.startsWith('ws://') ||
    rawHost.startsWith('wss://') ||
    rawHost.startsWith('http://') ||
    rawHost.startsWith('https://')

  if (prefixed) {
    try {
      const parsed = new URL(rawHost)
      const scheme = parsed.protocol
      const isWebSocketScheme = scheme === 'ws:' || scheme === 'wss:'
      parsed.protocol = normalizeProtocol(scheme)
      parsed.search = ''
      parsed.hash = ''
      const hostPath = isWebSocketScheme ? normalizeGatewayPath(parsed.pathname) : ''
      parsed.pathname = '/'
      const base = parsed.toString()
      const finalPath = explicitPath || hostPath
      return appendPath(base, finalPath)
    } catch {
      return appendPath(rawHost, explicitPath)
    }
  }

  const { host: hostOnly, path: inferredPath } = stripPathFromHost(rawHost)
  const resolvedHost = hostOnly || '127.0.0.1'
  const compiledPath = explicitPath || inferredPath
  const wsProtocol = browserProtocol === 'https:' ? 'wss' : 'ws'
  const shouldOmitPort =
    wsProtocol === 'wss' &&
    !isLocalHost(resolvedHost) &&
    port === 18789
  const portSegment = shouldOmitPort ? '' : `:${port || 18789}`
  const formattedHost = formatHostForUrl(resolvedHost)
  const base = `${wsProtocol}://${formattedHost}${portSegment}`
  return appendPath(base, compiledPath)
}
