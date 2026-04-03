import { readFileSync } from 'node:fs'

/** Tailscale CLI binary paths to try (macOS app bundle, then PATH). */
const TAILSCALE_BINS = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  'tailscale',
]

export function execTailscaleServeJson(): any | null {
  const { execFileSync } = require('node:child_process')
  for (const bin of TAILSCALE_BINS) {
    try {
      const raw = execFileSync(bin, ['serve', 'status', '--json'], {
        timeout: 3000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return JSON.parse(raw)
    } catch {
      continue
    }
  }
  return null
}

/**
 * Find the Tailscale Serve port that proxies to a given local port.
 *
 * Looks through the `Web` section of `tailscale serve status --json` for any
 * handler whose Proxy target points at localhost:<targetPort>. Returns the
 * external Tailscale Serve port (e.g. 8443) or null if not found.
 */
export function findTailscaleServePort(web: Record<string, any> | null | undefined, targetPort: number): number | null {
  if (!web) return null

  const targetSuffixes = [`:${targetPort}`, `:${targetPort}/`]
  for (const [hostPort, hostConfig] of Object.entries(web) as [string, any][]) {
    const handlers = hostConfig?.Handlers
    if (!handlers) continue
    for (const handler of Object.values(handlers) as any[]) {
      const proxy = handler?.Proxy || ''
      if (targetSuffixes.some(s => proxy.endsWith(s) || proxy === `http://127.0.0.1:${targetPort}` || proxy === `http://localhost:${targetPort}`)) {
        // hostPort is like "hostname:8443"
        const port = parseInt(hostPort.split(':').pop() || '', 10)
        if (port > 0) return port
      }
    }
  }
  return null
}

/**
 * Detect whether Tailscale Serve is proxying to the gateway.
 *
 * Checks the Web config for:
 * 1. A `/gw` path handler (authoritative)
 * 2. Any handler proxying to port 18789 (port-based proxy)
 * 3. Fallback: `gateway.tailscale.mode === 'serve'` in openclaw.json (legacy)
 */
export function detectTailscaleServe(web: Record<string, any> | null | undefined, configPath?: string): boolean {
  if (web) {
    for (const hostConfig of Object.values(web) as any[]) {
      const handlers = (hostConfig as any)?.Handlers
      if (!handlers) continue
      if ((handlers as any)['/gw']) return true
      // Also detect port-based proxy to gateway (e.g. :8443 → localhost:18789)
      for (const handler of Object.values(handlers) as any[]) {
        const proxy = (handler as any)?.Proxy || ''
        if (proxy.includes(':18789')) return true
      }
    }
  }

  // Legacy: check openclaw.json config
  const effectivePath = configPath || process.env.OPENCLAW_CONFIG_PATH || ''
  if (!effectivePath) return false
  try {
    const raw = readFileSync(effectivePath, 'utf-8')
    const config = JSON.parse(raw)
    return config?.gateway?.tailscale?.mode === 'serve'
  } catch {
    return false
  }
}

/**
 * Check whether any Tailscale Serve handler has a `/gw` path.
 */
export function hasGwPathHandler(web: Record<string, any> | null | undefined): boolean {
  if (!web) return false
  for (const hostConfig of Object.values(web) as any[]) {
    if ((hostConfig as any)?.Handlers?.['/gw']) return true
  }
  return false
}

/** Cache Tailscale Serve JSON with 60-second TTL. */
let _tailscaleServeJsonCache: { value: any; expiresAt: number } | null = null
let _tailscaleServeCache: { value: boolean; expiresAt: number } | null = null
const TAILSCALE_CACHE_TTL_MS = 60_000

export function refreshTailscaleCache(): void {
  const now = Date.now()
  if (!_tailscaleServeJsonCache || now > _tailscaleServeJsonCache.expiresAt) {
    _tailscaleServeJsonCache = { value: execTailscaleServeJson(), expiresAt: now + TAILSCALE_CACHE_TTL_MS }
    _tailscaleServeCache = null // invalidate derived cache
  }
}

export function getCachedTailscaleWeb(): Record<string, any> | null {
  return _tailscaleServeJsonCache?.value?.Web ?? null
}

export function isTailscaleServe(): boolean {
  refreshTailscaleCache()
  const now = Date.now()
  if (!_tailscaleServeCache || now > _tailscaleServeCache.expiresAt) {
    _tailscaleServeCache = { value: detectTailscaleServe(getCachedTailscaleWeb()), expiresAt: now + TAILSCALE_CACHE_TTL_MS }
  }
  return _tailscaleServeCache.value
}

/** Reset caches — for testing only. */
export function _resetCaches(): void {
  _tailscaleServeJsonCache = null
  _tailscaleServeCache = null
}
