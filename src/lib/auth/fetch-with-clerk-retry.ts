// Bug 11 (sess-10, 2026-05-21) — Clerk satellite handshake race.
//
// On in-app soft-nav across satellite boundaries (e.g. /chat → /agents),
// Clerk's middleware may briefly reject /api/* with 401 before the
// satellite cookie rotation completes (p95 ~400ms in observed prod
// traffic). Client panels that treat 401 as terminal and call
// `window.location.assign('/login?next=...')` hard-nav to MC's INNER
// OpenClaw login page BEFORE Clerk handshake has a chance to resolve.
//
// This helper retries 401s with backoff and escalates to Clerk's
// sign-in URL (not MC inner /login) when still 401 after retries.

export interface ClerkAwareFetchOptions extends RequestInit {
  /**
   * Used as final fallback when no Clerk sign-in URL can be resolved.
   * Should be the same legacy path the call site previously used
   * (e.g. `/login?next=%2Fagents`) so that MC-without-Clerk
   * deployments behave identically to before this helper existed.
   */
  loginFallbackPath: string
  /** Max 401 retries. Default 2. */
  maxRetries?: number
  /** Backoff delays in ms between retries. Default [300, 900]. */
  retryDelaysMs?: number[]
}

/**
 * Returns the eventual Response, or undefined when the helper has
 * already navigated the page (caller should bail without showing an
 * error). Never throws.
 */
export async function fetchWithClerkRetry(
  input: string | URL,
  init: ClerkAwareFetchOptions,
): Promise<Response | undefined> {
  const {
    loginFallbackPath,
    maxRetries = 2,
    retryDelaysMs = [300, 900],
    ...fetchInit
  } = init

  let response = await fetch(input, fetchInit)
  let attempt = 0
  while (response.status === 401 && attempt < maxRetries) {
    const delayMs = retryDelaysMs[attempt] ?? retryDelaysMs[retryDelaysMs.length - 1] ?? 600
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    response = await fetch(input, fetchInit)
    attempt++
  }

  if (response.status === 401) {
    redirectToSignIn(loginFallbackPath)
    return undefined
  }

  return response
}

function redirectToSignIn(loginFallbackPath: string): void {
  if (typeof window === 'undefined') return
  window.location.assign(resolveClerkSignInUrl(loginFallbackPath))
}

/**
 * Resolves the redirect target for a still-401 escalation.
 *
 * Precedence (highest first):
 *   1. NEXT_PUBLIC_CLERK_SIGN_IN_URL (explicit prod config)
 *   2. derived from NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY domain (`https://<domain>/sign-in`)
 *   3. loginFallbackPath (MC inner /login — legacy non-Clerk behavior)
 *
 * Steps 1-2 also encode the current page as `redirect_url` so the
 * user returns where they were after sign-in completes.
 */
export function resolveClerkSignInUrl(loginFallbackPath: string): string {
  const explicit = (process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || '').trim()
  if (explicit) {
    return appendRedirectUrl(explicit)
  }
  const pk = (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '').trim()
  if (pk) {
    const domain = decodePublishableKeyDomain(pk)
    if (domain) {
      return appendRedirectUrl(`https://${domain}/sign-in`)
    }
  }
  return loginFallbackPath
}

function appendRedirectUrl(baseUrl: string): string {
  try {
    const u = new URL(baseUrl)
    if (typeof window !== 'undefined' && window.location?.href) {
      u.searchParams.set('redirect_url', window.location.href)
    }
    return u.toString()
  } catch {
    return baseUrl
  }
}

/**
 * Clerk publishable keys: `pk_(test|live)_<base64(domain.tld$)>`.
 * Returns the decoded domain without the trailing `$` delimiter,
 * or null if the key is malformed.
 */
export function decodePublishableKeyDomain(pk: string): string | null {
  try {
    const match = /^pk_(test|live)_(.+)$/.exec(pk)
    if (!match) return null
    const encoded = match[2]
    const decoded = typeof atob === 'function'
      ? atob(encoded)
      : Buffer.from(encoded, 'base64').toString('utf8')
    const domain = decoded.replace(/\$$/, '').trim()
    return domain || null
  } catch {
    return null
  }
}
