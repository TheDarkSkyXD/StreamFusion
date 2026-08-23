/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'path';

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
    maxWorkers: '25%',
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: [path.resolve(__dirname, './tests/setup-node.ts')],
          include: ['tests/backend/**/*.test.{ts,tsx}'],
          exclude: backendDomTests,
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          setupFiles: [path.resolve(__dirname, './tests/setup.ts')],
          include: [...nonBackendTests, ...backendDomTests],
        },
      },
    ],
    alias: {
      '@/': path.resolve(__dirname, './src') + '/',
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
        'src/main.ts',
        'src/preload/**',
        'src/renderer.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@/': path.resolve(__dirname, './src') + '/',
      '@backend/': path.resolve(__dirname, './src/backend') + '/',
      '@frontend/': path.resolve(__dirname, './src/frontend') + '/',
      '@shared/': path.resolve(__dirname, './src/shared') + '/',
    },
  },
});
