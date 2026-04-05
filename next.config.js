const withNextIntl = require('next-intl/plugin')('./src/i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel does not support standalone output; only use it for self-hosted builds
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
  outputFileTracingExcludes: {
    '/*': ['./.data/**/*'],
  },
  // Ensure better-sqlite3 native bindings are bundled in serverless functions
  serverExternalPackages: ['better-sqlite3', 'node-pty'],
  turbopack: {},
  // Transpile ESM-only packages so they resolve correctly in all environments
  transpilePackages: ['react-markdown', 'remark-gfm'],
  
  // Security headers
  // Content-Security-Policy is set in src/proxy.ts with a per-request nonce.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(process.env.NODE_ENV === 'production' && process.env.MC_DISABLE_HSTS !== '1' || process.env.MC_ENABLE_HSTS === '1' ? [
            { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }
          ] : []),
        ],
      },
    ];
  },
  
};

module.exports = withNextIntl(nextConfig);
