import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import viteCompression from 'vite-plugin-compression';
import { visualizer } from 'rollup-plugin-visualizer';

const isProduction = process.env.NODE_ENV === 'production';

export default defineConfig({
    // ========== Main Process ==========
    main: {
        resolve: {
            alias: {
                '@': resolve(__dirname, './src'),
                '@backend': resolve(__dirname, './src/backend'),
                '@shared': resolve(__dirname, './src/shared'),
            },
        },
        build: {
            // electron-vite v5: use build.externalizeDeps instead of plugin
            externalizeDeps: {
                // Bundle these ESM-only packages into main process output
                // (they won't be in node_modules in the packaged app,
                //  or they are ESM-only and CJS require() fails)
                exclude: [
                    'electron-store',
                    'conf',
                    'dotenv',
                    'electron-log',
                    'electron-updater',
                    'electron-util',
                    'electron-trpc-link',
                    '@electron-toolkit/utils',
                    '@electron-toolkit/preload',
                    'chokidar',
                    'axios',
                    'ky',
                    'html-entities',
                    'tldts',
                    'dayjs',
                    'lodash-es',
                    'reconnecting-websocket',
                    'pusher-js',
                    'tmi.js',
                    '@trpc/server',
                    '@trpc/client',
                    '@iarna/toml',
                    '@repeaterjs/repeater',
                    'update-electron-app',
                    'zod',
                ],
            },
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'src/main.ts'),
                },
                // Native modules must stay external (rebuilt by electron-builder)
                external: ['better-sqlite3'],
            },
            // Target Node.js version used by Electron
            target: 'node20',
            sourcemap: !isProduction,
        },
        esbuild: {
            drop: isProduction ? ['debugger'] : [],
            pure: isProduction ? ['console.debug'] : [],
        },
    },

    // ========== Preload Script ==========
    preload: {
        resolve: {
            alias: {
                '@': resolve(__dirname, './src'),
                '@shared': resolve(__dirname, './src/shared'),
            },
        },
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'src/preload/index.ts'),
                },
            },
            sourcemap: !isProduction,
            minify: 'esbuild',
        },
        esbuild: {
            drop: isProduction ? ['debugger'] : [],
            pure: isProduction ? ['console.debug'] : [],
        },
    },

    // ========== Renderer Process ==========
    renderer: {
        // index.html lives at project root (not src/renderer/)
        root: '.',
        plugins: [
            react(),
            svgr({
                svgrOptions: {
                    icon: true,
                    svgoConfig: {
                        plugins: [{ name: 'removeViewBox', active: false }],
                    },
                },
            }),
            ...(isProduction
                ? [
                    viteCompression({
                        algorithm: 'brotliCompress',
                        ext: '.br',
                        threshold: 10240,
                        deleteOriginFile: false,
                    }),
                ]
                : []),
            ...(process.env.ANALYZE
                ? [
                    visualizer({
                        open: true,
                        filename: './out/stats.html',
                        gzipSize: true,
                        brotliSize: true,
                    }),
                ]
                : []),
        ],
        resolve: {
            alias: {
                '@': resolve(__dirname, './src'),
                '@backend': resolve(__dirname, './src/backend'),
                '@frontend': resolve(__dirname, './src/frontend'),
                '@shared': resolve(__dirname, './src/shared'),
            },
        },
        build: {
            outDir: 'out/renderer',
            rollupOptions: {
                input: resolve(__dirname, 'index.html'),
                treeshake: {
                    moduleSideEffects: 'no-external',
                    propertyReadSideEffects: false,
                    tryCatchDeoptimization: false,
                },
                output: {
                    manualChunks: {
                        'vendor-core': ['react', 'react-dom', 'zustand'],
                        'vendor-tanstack': ['@tanstack/react-router', '@tanstack/react-query'],
                        'vendor-player': ['hls.js'],
                        'vendor-ui': [
                            '@radix-ui/react-dialog',
                            '@radix-ui/react-tooltip',
                            '@radix-ui/react-select',
                            '@radix-ui/react-switch',
                            '@radix-ui/react-scroll-area',
                            '@radix-ui/react-progress',
                            '@radix-ui/react-slot',
                        ],
                        'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
                    },
                    chunkFileNames: isProduction ? 'assets/[name]-[hash].js' : 'assets/[name].js',
                    assetFileNames: isProduction ? 'assets/[name]-[hash][extname]' : 'assets/[name][extname]',
                },
            },
            target: 'esnext',
            sourcemap: !isProduction,
            minify: 'esbuild',
            cssCodeSplit: true,
            assetsInlineLimit: 4096,
            chunkSizeWarningLimit: 500,
        },
        optimizeDeps: {
            include: [
                'react',
                'react-dom',
                '@tanstack/react-query',
                '@tanstack/react-router',
                'zustand',
                'hls.js',
                'framer-motion',
                'clsx',
                'tailwind-merge',
                'class-variance-authority',
                'lucide-react',
            ],
            exclude: ['better-sqlite3'],
        },
        esbuild: {
            drop: isProduction ? ['debugger'] : [],
            pure: isProduction ? ['console.debug'] : [],
            minifyIdentifiers: isProduction,
            minifySyntax: isProduction,
            minifyWhitespace: isProduction,
        },
        css: {
            modules: {
                localsConvention: 'camelCase',
            },
        },
    },
});
