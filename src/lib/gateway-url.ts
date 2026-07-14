function isLocalHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.endsWith('.local')
  )
}

function normalizeProtocol(protocol: string): 'ws:' | 'wss:' {
  if (protocol === 'https:' || protocol === 'wss:') return 'wss:'
  return 'ws:'
}

function preserveTokenQuery(parsed: URL): void {
  const token = parsed.searchParams.get('token')
  parsed.search = ''
  if (token) {
    parsed.searchParams.set('token', token)
  }
}

function normalizeGatewayPath(pathname: string): string {
  const path = String(pathname || '/').trim() || '/'
  if (
    path === '/sessions' ||
    path === '/sessions/' ||
    path.startsWith('/sessions/')
  ) {
    return '/'
  }
  return path === '/' ? '/' : path.replace(/\/+$/, '')
}

function formatWebSocketUrl(parsed: URL): string {
  return parsed.toString().replace(/\/$/, '').replace('/?', '?')
}

export function buildGatewayPathFallbackUrls(rawUrl: string): string[] {
  const trimmed = String(rawUrl || '').trim()
  if (!trimmed) return []

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return []
  }

  const normalizedPath = (parsed.pathname || '/').replace(/\/+$/, '') || '/'
  if (normalizedPath !== '/') return []

  const fallbacks = ['/gateway-ws', '/gw']
  const seen = new Set<string>([formatWebSocketUrl(parsed)])
  const urls: string[] = []

  for (const path of fallbacks) {
    parsed.pathname = path
    const candidate = formatWebSocketUrl(parsed)
    if (!seen.has(candidate)) {
      seen.add(candidate)
      urls.push(candidate)
    }
  }

  return urls
}

function normalizeOptionalWebSocketUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function chooseGatewayConnectUrl(input: {
  resolvedWsUrl?: unknown
  storedWsUrl?: unknown
}): string {
  const resolvedWsUrl = normalizeOptionalWebSocketUrl(input.resolvedWsUrl)
  if (resolvedWsUrl) return resolvedWsUrl

  return normalizeOptionalWebSocketUrl(input.storedWsUrl)
}

export function shouldClearStoredGatewayUrl(input: {
  resolvedWsUrl?: unknown
  storedWsUrl?: unknown
}): boolean {
  const resolvedWsUrl = normalizeOptionalWebSocketUrl(input.resolvedWsUrl)
  const storedWsUrl = normalizeOptionalWebSocketUrl(input.storedWsUrl)
  return Boolean(resolvedWsUrl && storedWsUrl && resolvedWsUrl !== storedWsUrl)
}

export function buildBrowserGatewayPathUrl(input: {
  browserHost: string
  path: string
  browserProtocol?: string
}): string {
  const browserHost = String(input.browserHost || '').trim()
  if (!browserHost) return ''

  const protocol = input.browserProtocol === 'http:' ? 'ws' : 'wss'
  const path = String(input.path || '/').startsWith('/')
    ? String(input.path || '/')
    : `/${String(input.path || '/')}`
  return `${protocol}://${browserHost}${path}`
}

export function buildGatewayWebSocketUrl(input: {
  host: string
  port: number
  browserProtocol?: string
}): string {
  const rawHost = String(input.host || '').trim()
  const port = Number(input.port)
  const browserProtocol = input.browserProtocol === 'https:' ? 'https:' : 'http:'

  if (!rawHost) {
    // Default host is localhost — use wss:// when the browser is on HTTPS and a reverse
    // proxy is likely fronting the gateway (e.g. nginx/Caddy/Tailscale Serve).
    // Direct localhost connections still work because browsers allow ws://127.0.0.1
    // from HTTPS pages (mixed-content exception), but the gateway may reject the
    // WebSocket Origin header if it doesn't match allowedOrigins.
    const useWss = browserProtocol === 'https:' && process.env.NEXT_PUBLIC_GATEWAY_REVERSE_PROXY === '1'
    return `${useWss ? 'wss' : 'ws'}://127.0.0.1:${port || 18789}`
  }

  const prefixed =
    rawHost.startsWith('ws://') ||
    rawHost.startsWith('wss://') ||
    rawHost.startsWith('http://') ||
    rawHost.startsWith('https://')
      ? rawHost
      : null

  if (prefixed) {
    try {
      const parsed = new URL(prefixed)
      // Local hosts use plain ws:// unless the URL was explicitly wss://
      // (i.e. a reverse proxy is terminating TLS in front of the gateway).
      // http://, https://, and ws:// all collapse to ws:// for localhost since
      // the gateway itself does not speak TLS. Only wss:// is preserved as the
      // operator's explicit opt-in.
      if (isLocalHost(parsed.hostname)) {
        parsed.protocol = parsed.protocol === 'wss:' ? 'wss:' : 'ws:'
      } else {
        parsed.protocol = normalizeProtocol(parsed.protocol)
      }
      // Keep explicit proxy paths (e.g. /gw), but collapse known dashboard/session routes to root.
      parsed.pathname = normalizeGatewayPath(parsed.pathname)
      preserveTokenQuery(parsed)
      parsed.hash = ''
      return formatWebSocketUrl(parsed)
    } catch {
      return prefixed
    }
  }

  // Local gateway hosts use plain ws:// by default — they don't speak TLS.
  // However, if NEXT_PUBLIC_GATEWAY_REVERSE_PROXY=1 and browser is on HTTPS, use wss://
  // because a reverse proxy is likely fronting the gateway and the browser would block
  // mixed-content ws:// from an HTTPS page (or the gateway would reject the Origin).
  const wsProtocol = isLocalHost(rawHost)
    ? (browserProtocol === 'https:' && process.env.NEXT_PUBLIC_GATEWAY_REVERSE_PROXY === '1' ? 'wss' : 'ws')
    : (browserProtocol === 'https:' ? 'wss' : 'ws')
  const shouldOmitPort =
    wsProtocol === 'wss' &&
    !isLocalHost(rawHost) &&
    port === 18789

  return shouldOmitPort
    ? `${wsProtocol}://${rawHost}`
    : `${wsProtocol}://${rawHost}:${port || 18789}`
}
