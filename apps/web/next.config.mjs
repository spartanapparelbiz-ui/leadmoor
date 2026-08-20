import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import nextEnv from '@next/env';

/*
 * Configuration lives in the repository root .env, but Next only reads the .env beside the app it
 * is building. Loading the root one here — with Next's own loader, so the precedence rules are
 * identical — means one file configures the web app, the worker, and the scripts alike.
 *
 * Values stay in process.env on the server. Nothing is inlined into the client bundle: there is no
 * NEXT_PUBLIC_ variable in this product.
 */
nextEnv.loadEnvConfig(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'),
  process.env.NODE_ENV !== 'production',
);

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
