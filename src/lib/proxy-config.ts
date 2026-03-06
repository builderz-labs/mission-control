'use client'

/**
 * Client-side proxy mode flag.
 *
 * Set NEXT_PUBLIC_GATEWAY_PROXY_MODE=1 (alongside GATEWAY_PROXY_MODE=1) to
 * enable server-side gateway proxying for both the server and the browser.
 */
export const GATEWAY_PROXY_MODE =
  process.env.NEXT_PUBLIC_GATEWAY_PROXY_MODE === '1' ||
  process.env.NEXT_PUBLIC_GATEWAY_PROXY_MODE === 'true'
