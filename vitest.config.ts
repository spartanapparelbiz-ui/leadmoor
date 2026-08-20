import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@leadmoor/core': pkg('core'),
      '@leadmoor/claims': pkg('claims'),
      '@leadmoor/db': pkg('db'),
      '@leadmoor/policy': pkg('policy'),
      '@leadmoor/evidence': pkg('evidence'),
      '@leadmoor/connectors': pkg('connectors'),
      '@leadmoor/resolution': pkg('resolution'),
      '@leadmoor/scoring': pkg('scoring'),
      '@leadmoor/llm': pkg('llm'),
      '@leadmoor/runtime': pkg('runtime'),
      '@leadmoor/export': pkg('export'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});
