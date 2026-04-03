const withNextIntl = require('next-intl/plugin')('./src/i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingExcludes: {
    '/*': ['./.data/**/*', './src/jarvis/.venv/**/*'],
  },
  turbopack: {},
  devIndicators: false,
  // Transpile ESM-only packages so they resolve correctly in all environments
  transpilePackages: ['react-markdown', 'remark-gfm'],

  // Security headers
  // Content-Security-Policy is set in src/middleware.ts with a per-request nonce.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
          // CORS: restrict cross-origin requests to the configured origin (defaults to same-origin)
          { key: 'Access-Control-Allow-Origin', value: process.env.ALLOWED_ORIGIN ?? 'same-origin' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, X-API-Key' },
          ...(process.env.MC_ENABLE_HSTS === '1' ? [
            { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }
          ] : []),
        ],
      },
    ];
  },

};

module.exports = withNextIntl(nextConfig);
