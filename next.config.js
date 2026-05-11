const withNextIntl = require('next-intl/plugin')('./src/i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  outputFileTracingExcludes: {
    // `.git` must be excluded so the Next.js file tracer does not copy the
    // entire repo .git directory into `.next/standalone/`. When it does,
    // Git treats the standalone dir as its own working tree and the
    // self-update endpoint's `git status --porcelain` (run from
    // process.cwd() under `pnpm start:standalone`) reports every file the
    // standalone build doesn't bundle (e.g. `src/lib/__tests__/`) as
    // deleted — blocking the dirty-tree check and breaking self-update.
    '/*': ['./.data/**/*', './.git/**/*'],
  },
  turbopack: {
    root: __dirname,
  },
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
