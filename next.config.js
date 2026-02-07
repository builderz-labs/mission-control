/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
  
  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* wss://127.0.0.1:* wss://*.ts.net wss://*.tail*.ts.net ws://localhost:*; img-src 'self' data: blob:; font-src 'self' data:;" },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  
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