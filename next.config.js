/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  turbopack: {},

  // CSP is enforced in `src/proxy.ts` with per-request nonces.
  // Keep policy logic out of static build-time headers to avoid drift.
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      os: false,
      fs: false,
      path: false,
    };
    return config;
  },
};

module.exports = nextConfig;
