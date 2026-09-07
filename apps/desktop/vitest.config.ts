/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import { availableParallelism } from "node:os";
import path from "path";

const systemTestPattern = "**/*.system.test.{ts,tsx}";
const deterministicWorkers = Math.min(8, availableParallelism());
const nodeOnlyTests = [
  "tests/helpers/better-sqlite3-shim.test.ts",
  "src/frontend/features/chat/tests/services/emotes/twitch-user-emotes.integration.test.ts",
  "src/frontend/features/chat/tests/services/emotes/twitch-emotes.test.ts",
  "src/frontend/features/chat/tests/services/emotes/7tv-emotes.test.ts",
  "src/frontend/features/chat/tests/services/emotes/ffz-emotes.test.ts",
  "src/frontend/features/chat/tests/services/emotes/bttv-emotes.test.ts",
  "src/frontend/features/chat/tests/services/chat/twitch-roomstate.test.ts",
  "src/frontend/features/chat/tests/services/chat/twitch-parser.test.ts",
  "src/frontend/features/chat/tests/services/chat/twitch-irc-parser.test.ts",
  "src/frontend/features/chat/tests/services/chat/twitch-hermes-client.test.ts",
  "src/frontend/features/chat/tests/services/chat/kick-chat-pin.test.ts",
  "src/frontend/features/chat/tests/services/chat/raid-handoff-parsers.test.ts",
  "src/frontend/features/chat/tests/services/chat/kick-predictions-service.test.ts",
  "src/frontend/features/chat/tests/services/chat/seven-tv-cosmetics-client.test.ts",
  "src/frontend/features/chat/tests/services/chat/third-party-emote-enrich.test.ts",
  "src/frontend/features/chat/tests/services/chat/badge-resolver.test.ts",
  "src/frontend/features/chat/tests/services/chat/kick-roomstate.test.ts",
  "src/frontend/features/chat/tests/services/chat/kick-prediction-normalizer.test.ts",
  "src/frontend/features/chat/tests/services/chat/chat-parser-emotes.test.ts",
  "src/frontend/features/chat/tests/services/chat/kick-chat.test.ts",
  "src/frontend/features/chat/tests/services/chat/kick-parser.test.ts",
  "src/frontend/features/chat/tests/api/platforms/kick/kick-predictions.test.ts",
];

const backendDomTests = [
  "src/backend/features/authentication/tests/api/platforms/kick/follow-grid-predicate.test.ts",
  "src/backend/features/authentication/tests/auth/auth-header-predicate.test.ts",
  "src/backend/features/media-library/tests/routes/stream-recording-ipc-contract.test.ts",
  "src/backend/features/authentication/tests/adapters/twitch/twitch-auth-restart.integration.test.ts",
  "src/backend/features/playback/tests/adapters/electron/network-adblock-service.test.ts",
  "src/backend/features/playback/tests/adapters/electron/cosmetic-injection-service.test.ts",
  "src/backend/features/discovery/tests/adapters/electron/preload/user-profiles.test.ts",
  "src/backend/features/moderation/tests/adapters/electron/preload/timeout-moderation.test.ts",
  "src/backend/features/media-library/tests/adapters/electron/preload/stream-recording.test.ts",
  "src/backend/features/media-library/tests/adapters/electron/preload/downloads.test.ts",
  "src/backend/features/playback/tests/adapters/electron/preload/local-captions.test.ts",
  "src/backend/features/discovery/tests/adapters/electron/preload/category-media.test.ts",
];

const nonBackendTests = [
  "tests/*.test.{ts,tsx}",
  "tests/!(backend)/**/*.test.{ts,tsx}",
  "src/frontend/**/*.test.{ts,tsx}",
  "src/shared/**/*.test.{ts,tsx}",
];

export default defineConfig({
  define: {
    "process.env.NODE_ENV": '"test"',
  },
  test: {
    globals: true,
    maxWorkers: deterministicWorkers,
    silent: "passed-only",
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          setupFiles: [path.resolve(__dirname, "./tests/setup-node.ts")],
          include: [
            "tests/backend/**/*.test.{ts,tsx}",
            "src/backend/**/tests/**/*.test.{ts,tsx}",
            ...nodeOnlyTests,
          ],
          exclude: [...backendDomTests, systemTestPattern],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: [path.resolve(__dirname, "./tests/setup.ts")],
          include: [...nonBackendTests, ...backendDomTests],
          exclude: [systemTestPattern, ...nodeOnlyTests],
        },
      },
      {
        extends: true,
        test: {
          name: "system-windows",
          environment: "node",
          setupFiles: [path.resolve(__dirname, "./tests/setup-node.ts")],
          include: [systemTestPattern],
          maxWorkers: 1,
          fileParallelism: false,
        },
      },
    ],
    alias: {
      "@/": path.resolve(__dirname, "./src/frontend") + "/",
      "@backend/": path.resolve(__dirname, "./src/backend") + "/",
      "@frontend/": path.resolve(__dirname, "./src/frontend") + "/",
      "@shared/": path.resolve(__dirname, "./src/shared") + "/",
      // The repo ships better-sqlite3 compiled against Electron's
      // NODE_MODULE_VERSION; vitest runs under system Node. Route imports
      // to a node:sqlite-backed shim so DB tests run without a binary
      // rebuild dance. See tests/helpers/better-sqlite3-shim.ts.
      "better-sqlite3": path.resolve(__dirname, "./tests/helpers/better-sqlite3-shim.ts"),
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/tests/**",
        "src/**/*.stories.*",
        "src/backend/main.ts",
        "src/backend/preload/**",
        "src/frontend/renderer.tsx",
      ],
    },
  },
  resolve: {
    alias: {
      "@/": path.resolve(__dirname, "./src/frontend") + "/",
      "@backend/": path.resolve(__dirname, "./src/backend") + "/",
      "@frontend/": path.resolve(__dirname, "./src/frontend") + "/",
      "@shared/": path.resolve(__dirname, "./src/shared") + "/",
    },
  },
});
