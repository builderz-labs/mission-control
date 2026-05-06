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
      // Local hosts use plain ws:// unless the URL was explicitly set to wss://
      // (e.g. wss://127.0.0.1 via reverse proxy that terminates TLS).
      if (!isLocalHost(parsed.hostname)) {
        parsed.protocol = normalizeProtocol(parsed.protocol)
      }
      // else: preserve the protocol the user explicitly set (ws:// or wss://)
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
