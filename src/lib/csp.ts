export function buildMissionControlCsp(input: { nonce: string; googleEnabled: boolean }): string {
  const { nonce, googleEnabled } = input

  return [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' blob:${googleEnabled ? ' https://accounts.google.com' : ''}`,
    // Nonce restricts <style> tag injection to only those emitted by the server
    // (e.g. next-themes injects a <style> nonce-tagged by ThemeProvider).
    // 'unsafe-inline' is intentionally absent here — adding it would negate the nonce.
    `style-src 'self' 'nonce-${nonce}'`,
    `style-src-elem 'self' 'nonce-${nonce}'`,
    // style-src-attr governs inline style="..." attributes on DOM elements.
    // Nonces cannot be applied to element attributes, so 'unsafe-inline' is required here.
    // JSX style={{}} props render as element attributes and are covered by this directive.
    `style-src-attr 'unsafe-inline'`,
    `connect-src 'self' ws: wss: http://127.0.0.1:* http://localhost:* https://cdn.jsdelivr.net`,
    `img-src 'self' data: blob:${googleEnabled ? ' https://*.googleusercontent.com https://lh3.googleusercontent.com' : ''}`,
    `font-src 'self' data:`,
    `frame-src 'self'${googleEnabled ? ' https://accounts.google.com' : ''}`,
    `worker-src 'self' blob:`,
  ].join('; ')
}

export function buildNonceRequestHeaders(input: {
  headers: Headers
  nonce: string
  googleEnabled: boolean
}): Headers {
  const requestHeaders = new Headers(input.headers)
  const csp = buildMissionControlCsp({ nonce: input.nonce, googleEnabled: input.googleEnabled })

  requestHeaders.set('x-nonce', input.nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  return requestHeaders
}
