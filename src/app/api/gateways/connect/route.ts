import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { buildGatewayWebSocketUrl } from '@/lib/gateway-url'
import { getDetectedGatewayToken } from '@/lib/gateway-runtime'
import {
  isTailscaleServe,
  refreshTailscaleCache,
  getCachedTailscaleWeb,
  hasGwPathHandler,
  findTailscaleServePort,
} from '@/lib/tailscale-serve'

interface GatewayEntry {
  id: number
  host: string
  port: number
  token: string
  is_primary: number
}

function inferBrowserProtocol(request: NextRequest): 'http:' | 'https:' {
  const forwardedProto = String(request.headers.get('x-forwarded-proto') || '').split(',')[0]?.trim().toLowerCase()
  if (forwardedProto === 'https') return 'https:'
  if (forwardedProto === 'http') return 'http:'

  const origin = request.headers.get('origin') || request.headers.get('referer') || ''
  if (origin) {
    try {
      const parsed = new URL(origin)
      if (parsed.protocol === 'https:') return 'https:'
      if (parsed.protocol === 'http:') return 'http:'
    } catch {
      // ignore and continue fallback resolution
    }
  }

  if (request.nextUrl.protocol === 'https:') return 'https:'
  return 'http:'
}

const LOCALHOST_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

// Docker-internal gateway DNS pattern: `<prefix>-gateway` (no TLD).
// Used by tenant MC containers on the openclaw docker network where
// the gateway is reachable as `<tenant>-gateway` from server but NOT
// from the user's browser. See `harden-tenants.sh` (mc-init-host-sync)
// which sets gateways.host to this docker DNS alias on every boot.
const DOCKER_GATEWAY_DNS = /^([a-z0-9][a-z0-9-]*?)-gateway$/i

/** Hostnames reachable from the server but NOT from the user's browser. */
function isNonBrowserReachableHost(host: string): boolean {
  const h = (host || '').toLowerCase().trim()
  if (LOCALHOST_HOSTS.has(h)) return true
  // Docker-internal hostnames — browser cannot resolve these
  if (h === 'host.docker.internal' || h === 'host-gateway') return true
  // Docker bridge network IPs (172.17.x.x, 172.18.x.x, etc.)
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  // Docker DNS gateway alias (e.g. ceremonia-gateway, lumina-gateway).
  // Container-network-only — never resolvable from a browser.
  if (DOCKER_GATEWAY_DNS.test(h)) return true
  return false
}

/**
 * For tenant MC satellites at `mc-<slug>.holalumina.com`, the docker-DNS
 * gateway `<prefix>-gateway` maps to the public gateway domain
 * `<prefix>.holalumina.com` (per `infra/caddy/Caddyfile`). Returns the
 * browser-reachable WSS URL when the pattern matches; null otherwise.
 *
 * The <prefix> is NOT always the MC slug — e.g. mc-eric routes to
 * `ericedmeades-gateway` → `ericedmeades.holalumina.com`. We always
 * derive the public domain from gateway.host, never from the MC slug.
 */
function deriveHolaluminaGatewayUrl(gatewayHost: string, browserHost: string): string | null {
  const m = gatewayHost.toLowerCase().trim().match(DOCKER_GATEWAY_DNS)
  if (!m) return null
  if (!browserHost.toLowerCase().endsWith('.holalumina.com')) return null
  return `wss://${m[1]}.holalumina.com/`
}

/** Extract the browser-facing hostname from the request. */
function getBrowserHostname(request: NextRequest): string {
  const origin = request.headers.get('origin') || request.headers.get('referer') || ''
  if (origin) {
    try { return new URL(origin).hostname } catch { /* ignore */ }
  }
  const hostHeader = request.headers.get('host') || ''
  return hostHeader.split(':')[0]
}

/**
 * When the gateway is on localhost but the browser is remote, resolve the
 * correct WebSocket URL the browser should use.
 *
 * - Tailscale Serve mode: `wss://<dashboard-host>/gw` (Tailscale proxies /gw to localhost gateway)
 * - Otherwise: rewrite host to dashboard hostname with the gateway port
 */
function resolveRemoteGatewayUrl(
  gateway: { host: string; port: number },
  request: NextRequest,
): string | null {
  const normalized = (gateway.host || '').toLowerCase().trim()
  if (!isNonBrowserReachableHost(normalized)) return null // browser-reachable host — use normal path

  const browserHost = getBrowserHostname(request)
  if (!browserHost || LOCALHOST_HOSTS.has(browserHost.toLowerCase())) return null // local access

  // holalumina.com tenant MC satellites: docker-DNS gateway → public
  // gateway domain. Caddy already terminates TLS + proxies the public
  // domain (e.g. ceremonia.holalumina.com) straight to <prefix>-gateway:18789
  // with no Clerk gate, so the browser WSS handshake succeeds without
  // routing through the MC Next.js Clerk-wrapped proxy.
  const holaUrl = deriveHolaluminaGatewayUrl(normalized, browserHost)
  if (holaUrl) return holaUrl

  // Browser is remote — determine the correct proxied URL
  if (isTailscaleServe()) {
    // Check for a /gw path-based proxy first
    refreshTailscaleCache()
    const web = getCachedTailscaleWeb()
    if (hasGwPathHandler(web)) {
      return `wss://${browserHost}/gw`
    }
    // Port-based proxy: find the Tailscale Serve port that proxies to the gateway port
    const tsPort = findTailscaleServePort(web, gateway.port)
    if (tsPort) {
      return `wss://${browserHost}:${tsPort}`
    }
  }

  // No Tailscale Serve — try direct connection to dashboard host on gateway port
  const protocol = inferBrowserProtocol(request) === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${browserHost}:${gateway.port}`
}

function ensureTable(db: ReturnType<typeof getDatabase>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gateways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL DEFAULT '127.0.0.1',
      port INTEGER NOT NULL DEFAULT 18789,
      token TEXT NOT NULL DEFAULT '',
      is_primary INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_seen INTEGER,
      latency INTEGER,
      sessions_count INTEGER NOT NULL DEFAULT 0,
      agents_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)
}

/**
 * POST /api/gateways/connect
 * Resolves websocket URL and token for a selected gateway without exposing tokens in list payloads.
 */
export async function POST(request: NextRequest) {
  // Any authenticated dashboard user may initiate a gateway websocket connect.
  // Restricting this to operator can cause startup fallback to connect without auth,
  // which then fails as "device identity required".
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  ensureTable(db)

  let id: number | null = null
  try {
    const body = await request.json()
    id = Number(body?.id)
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!id || !Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const gateway = db.prepare('SELECT id, host, port, token, is_primary FROM gateways WHERE id = ?').get(id) as GatewayEntry | undefined
  if (!gateway) {
    return NextResponse.json({ error: 'Gateway not found' }, { status: 404 })
  }

  // Prefer an explicitly configured browser WebSocket URL when provided.
  // This is required for reverse-proxy setups where the browser-facing gateway
  // lives on a different host/path than the server-side localhost gateway.
  const explicitBrowserWsUrl = String(process.env.NEXT_PUBLIC_GATEWAY_URL || '').trim()

  // When gateway host is localhost but the browser is remote (e.g. Tailscale),
  // resolve the correct browser-accessible WebSocket URL.
  const remoteUrl = explicitBrowserWsUrl || resolveRemoteGatewayUrl(gateway, request)
  const ws_url = remoteUrl || buildGatewayWebSocketUrl({
    host: gateway.host,
    port: gateway.port,
    browserProtocol: inferBrowserProtocol(request),
  })

  const dbToken = (gateway.token || '').trim()
  const detectedToken = gateway.is_primary === 1 ? getDetectedGatewayToken() : ''
  const token = detectedToken || dbToken

  // Keep runtime DB aligned with detected OpenClaw gateway token for primary gateway.
  if (gateway.is_primary === 1 && detectedToken && detectedToken !== dbToken) {
    try {
      db.prepare('UPDATE gateways SET token = ?, updated_at = (unixepoch()) WHERE id = ?').run(detectedToken, gateway.id)
    } catch {
      // Non-fatal: connect still succeeds with detected token even if persistence fails.
    }
  }

  return NextResponse.json({
    id: gateway.id,
    ws_url,
    token,
    token_set: token.length > 0,
  })
}

// Test-only exports — underscored prefix marks "internal, do not import
// from app code". Mirrors the pattern in src/proxy.ts.
export const __test_isNonBrowserReachableHost = isNonBrowserReachableHost
export const __test_deriveHolaluminaGatewayUrl = deriveHolaluminaGatewayUrl
