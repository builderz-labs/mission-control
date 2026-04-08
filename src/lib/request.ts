/**
 * HTTP request utilities — header parsing, client IP extraction.
 *
 * SECURITY NOTE on X-Forwarded-For and X-Real-IP:
 * Both headers are client-settable. They are only trustworthy when injected
 * by a reverse proxy (nginx, caddy, envoy) that overwrites or appends to them.
 * The rightmost-walk algorithm assumes the trusted proxy is the last hop that
 * appended to XFF — any IP to the left of a trusted proxy is untrusted.
 */

/**
 * Extract the rightmost untrusted client IP from X-Forwarded-For.
 *
 * Walks the XFF chain right-to-left, skipping IPs present in `trusted`.
 * Returns the first (rightmost) IP not in the trusted set.
 *
 * Falls back to X-Real-IP (only meaningful when set by a trusted proxy,
 * e.g. nginx proxy_set_header X-Real-IP $remote_addr), then `fallback`.
 */
export function extractClientIpFromTrusted(
  request: Request,
  trusted: Set<string>,
  fallback = 'unknown',
): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff && trusted.size > 0) {
    const ips = xff.split(',').map(s => s.trim())
    for (let i = ips.length - 1; i >= 0; i--) {
      if (!trusted.has(ips[i])) return ips[i]
    }
  }
  return request.headers.get('x-real-ip')?.trim() || fallback
}
