const path = require('path')
const withNextIntl = require('next-intl/plugin')('./src/i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname),
  outputFileTracingExcludes: {
    '/*': ['./.data/**/*'],
  },
  turbopack: {
    root: path.join(__dirname),
  },
  // Transpile ESM-only packages so they resolve correctly in all environments
  transpilePackages: ['react-markdown', 'remark-gfm'],
  
  // Security headers. CSP is set here so it applies to every response (proxy-set headers
  // can be dropped in some Next.js 16 flows). Proxy still sets x-nonce and may set CSP for nonce.
  async headers() {
    const csp =
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
      "script-src 'self' 'unsafe-inline' blob: https://accounts.google.com; " +
      "style-src 'self' 'unsafe-inline'; style-src-elem 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; " +
      "connect-src 'self' ws: wss: http://127.0.0.1:* http://localhost:* https://cdn.jsdelivr.net; " +
      "img-src 'self' data: blob: https://*.googleusercontent.com https://lh3.googleusercontent.com; " +
      "font-src 'self' data: https://r2cdn.perplexity.ai https://fonts.gstatic.com; " +
      "frame-src 'self' https://accounts.google.com; worker-src 'self' blob:"
    const securityHeaders = [
      { key: 'Content-Security-Policy', value: csp },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ...(process.env.MC_ENABLE_HSTS === '1' ? [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }
      ] : []),
    ]
    return [
      // Apply security headers only to document/API routes so static assets (_next/static, _next/image) are served without modification (avoids 500 on chunks in some setups).
      {
        source: '/((?!_next/static|_next/image|favicon\\.ico|brand/).*)',
        headers: securityHeaders,
      },
    ]
  },
  
};

module.exports = withNextIntl(nextConfig);
