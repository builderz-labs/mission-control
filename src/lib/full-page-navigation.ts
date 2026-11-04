/**
 * Navigate with a full document load instead of a client-side transition.
 *
 * Use this only where the reload is the point: after login, logout, setup,
 * or an expired session, so the new session cookie is sent on every request
 * and no stale client state or RSC payload survives. For ordinary in-app
 * navigation use `useRouter().push()`.
 *
 * The path is resolved to an absolute same-origin URL first, which is the
 * form `@next/next/no-location-assign-relative-destination` accepts for an
 * intentional hard navigation.
 */
export function navigateWithFullReload(path: string): void {
  if (typeof window === 'undefined') return
  window.location.href = new URL(path, window.location.href).href
}
