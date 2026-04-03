/** JARVIS voice assistant configuration */

const DEFAULT_JARVIS_HOST = 'localhost'
const DEFAULT_JARVIS_PORT = 8340

export function getJarvisBaseUrl(): string {
  const host = process.env.JARVIS_HOST ?? DEFAULT_JARVIS_HOST
  const port = process.env.JARVIS_PORT ?? DEFAULT_JARVIS_PORT
  return `http://${host}:${port}`
}

export function isJarvisEnabled(): boolean {
  return process.env.JARVIS_ENABLED === 'true'
}

/** Client-side check — uses NEXT_PUBLIC_ prefix so it's available in the browser */
export function isJarvisEnabledClient(): boolean {
  return process.env.NEXT_PUBLIC_JARVIS_ENABLED === 'true'
}

/**
 * Build the WebSocket URL for the client.
 * Auto-detects wss:// when the page is served over HTTPS for production safety.
 * Override entirely with NEXT_PUBLIC_JARVIS_WS_URL for custom deployments.
 */
export function getJarvisWsUrl(): string {
  if (process.env.NEXT_PUBLIC_JARVIS_WS_URL) {
    return process.env.NEXT_PUBLIC_JARVIS_WS_URL
  }
  const host = process.env.NEXT_PUBLIC_JARVIS_HOST ?? DEFAULT_JARVIS_HOST
  const port = process.env.NEXT_PUBLIC_JARVIS_PORT ?? DEFAULT_JARVIS_PORT
  // Use wss:// when served over HTTPS (e.g. production), ws:// for local dev
  const protocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? 'wss'
      : 'ws'
  return `${protocol}://${host}:${port}`
}

/**
 * Auth token for the Jarvis WebSocket — passed as ?token= query param.
 * Falls back to NEXT_PUBLIC_JARVIS_AUTH_TOKEN if set directly in env.
 * In most deployments the token is fetched via fetchJarvisAuthToken() instead.
 */
export function getJarvisAuthToken(): string {
  return process.env.NEXT_PUBLIC_JARVIS_AUTH_TOKEN ?? ''
}

/**
 * Fetch the Jarvis auth token from the Ultron server-side API.
 * Resolves the token that Jarvis auto-generated in src/jarvis/.env on first run.
 * Returns empty string on failure so the caller can handle gracefully.
 */
export async function fetchJarvisAuthToken(): Promise<string> {
  // In SSR context there's no window — skip
  if (typeof window === 'undefined') return ''
  // Fast path: token already baked into build
  const baked = process.env.NEXT_PUBLIC_JARVIS_AUTH_TOKEN
  if (baked) return baked
  try {
    const res = await fetch('/api/jarvis/token', { credentials: 'include', signal: AbortSignal.timeout(8000) })
    if (!res.ok) return ''
    const data = await res.json() as { token?: string }
    return data.token ?? ''
  } catch {
    return ''
  }
}
