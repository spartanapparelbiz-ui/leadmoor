/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Internal packages are consumed as TypeScript source; Next compiles them with the app.
  transpilePackages: [
    '@leadmoor/auth',
    '@leadmoor/core',
    '@leadmoor/db',
    '@leadmoor/policy',
    '@leadmoor/evidence',
    '@leadmoor/claims',
    '@leadmoor/connectors',
    '@leadmoor/resolution',
    '@leadmoor/scoring',
    '@leadmoor/llm',
    '@leadmoor/runtime',
    '@leadmoor/export',
  ],
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
  webpack: (config) => {
    // Internal packages are ESM TypeScript: they import siblings as './x.js' while the file on
    // disk is './x.ts'. Node and vitest resolve that natively; webpack needs to be told.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
