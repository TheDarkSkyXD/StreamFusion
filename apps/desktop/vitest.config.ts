/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { availableParallelism } from 'node:os';
import path from 'path';

const systemTestPattern = 'tests/**/*.system.test.{ts,tsx}';
const deterministicWorkers = Math.min(8, availableParallelism());

const backendDomTests = [
  'tests/backend/api/platforms/kick/follow-grid-predicate.test.ts',
  'tests/backend/auth/auth-header-predicate.test.ts',
  'tests/backend/services/chat/twitch-chat.test.ts',
  'tests/backend/services/chat/twitch-pin-poller.test.ts',
  'tests/backend/services/emotes/emote-manager.test.ts',
  'tests/backend/services/emotes/kick-emotes.test.ts',
];

const nonBackendTests = [
  'tests/*.test.{ts,tsx}',
  'tests/!(backend)/**/*.test.{ts,tsx}',
  'src/**/*.test.{ts,tsx}',
];

export default defineConfig({
  define: {
    'process.env.NODE_ENV': '"test"',
  },
  test: {
    globals: true,
    maxWorkers: deterministicWorkers,
    silent: 'passed-only',
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: [path.resolve(__dirname, './tests/setup-node.ts')],
          include: ['tests/backend/**/*.test.{ts,tsx}'],
          exclude: [...backendDomTests, systemTestPattern],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          setupFiles: [path.resolve(__dirname, './tests/setup.ts')],
          include: [...nonBackendTests, ...backendDomTests],
          exclude: [systemTestPattern],
        },
      },
      {
        extends: true,
        test: {
          name: 'system-windows',
          environment: 'node',
          setupFiles: [path.resolve(__dirname, './tests/setup-node.ts')],
          include: [systemTestPattern],
          maxWorkers: 1,
          fileParallelism: false,
        },
      },
    ],
    alias: {
      '@/': path.resolve(__dirname, './src/frontend') + '/',
      '@backend/': path.resolve(__dirname, './src/backend') + '/',
      '@frontend/': path.resolve(__dirname, './src/frontend') + '/',
      '@shared/': path.resolve(__dirname, './src/shared') + '/',
      // The repo ships better-sqlite3 compiled against Electron's
      // NODE_MODULE_VERSION; vitest runs under system Node. Route imports
      // to a node:sqlite-backed shim so DB tests run without a binary
      // rebuild dance. See tests/helpers/better-sqlite3-shim.ts.
      'better-sqlite3': path.resolve(__dirname, './tests/helpers/better-sqlite3-shim.ts'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/backend/main.ts',
        'src/backend/preload/**',
        'src/frontend/renderer.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@/': path.resolve(__dirname, './src/frontend') + '/',
      '@backend/': path.resolve(__dirname, './src/backend') + '/',
      '@frontend/': path.resolve(__dirname, './src/frontend') + '/',
      '@shared/': path.resolve(__dirname, './src/shared') + '/',
    },
  },
});
