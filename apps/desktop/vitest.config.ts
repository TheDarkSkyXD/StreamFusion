/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  define: {
    'process.env.NODE_ENV': '"test"',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, './tests/setup.ts')],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
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
