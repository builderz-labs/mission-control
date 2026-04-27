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

function clean(value?: string) {
  return (value || '').trim()
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

export type GatewayUrlOptions = {
  locationProtocol: string
  locationHostname: string
  env?: Record<string, string | undefined>
  explicitUrl?: string
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
      // Local hosts use plain ws:// for http(s) URLs unless the user explicitly
      // supplied a websocket protocol. This avoids producing invalid
      // https:// URLs for the WebSocket constructor while preserving explicit
      // wss:// reverse-proxy configurations.
      if (isLocalHost(parsed.hostname) && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
        parsed.protocol = 'ws:'
      } else if (!isLocalHost(parsed.hostname)) {
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

export function resolveGatewayWebSocketUrl({
  locationProtocol,
  locationHostname,
  env = {},
  explicitUrl,
}: GatewayUrlOptions): string {
  const configuredUrl = clean(explicitUrl || env.NEXT_PUBLIC_GATEWAY_URL)
  if (configuredUrl) return buildGatewayWebSocketUrl({
    host: configuredUrl,
    port: Number(clean(env.NEXT_PUBLIC_GATEWAY_PORT) || '18789'),
    browserProtocol: locationProtocol,
  })

  const isHttps = locationProtocol === 'https:'
  const envHost = clean(env.NEXT_PUBLIC_GATEWAY_HOST)
  const isBrowserLoopback = isLoopbackHost(locationHostname)
  const isEnvLoopback = envHost ? isLoopbackHost(envHost) : false
  const gatewayHost = !isBrowserLoopback && isEnvLoopback
    ? locationHostname
    : (envHost || locationHostname)

  const envPort = clean(env.NEXT_PUBLIC_GATEWAY_PORT)
  const gatewayPort = isHttps
    ? ((envPort && envPort !== '18789') ? Number(envPort) : 18789)
    : Number(envPort || '18789')

  return buildGatewayWebSocketUrl({
    host: gatewayHost,
    port: gatewayPort,
    browserProtocol: locationProtocol,
  })
}

export function resolveGatewayToken(env: Record<string, string | undefined> = {}) {
  return clean(env.NEXT_PUBLIC_GATEWAY_TOKEN) || clean(env.NEXT_PUBLIC_WS_TOKEN)
}
