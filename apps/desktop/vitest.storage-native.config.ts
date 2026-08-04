/// <reference types="vitest" />
import path from "node:path";
import { defineConfig } from "vitest/config";

const sourceAliases = {
  "@/": path.resolve(__dirname, "./src") + "/",
  "@backend/": path.resolve(__dirname, "./src/backend") + "/",
  "@frontend/": path.resolve(__dirname, "./src/frontend") + "/",
  "@shared/": path.resolve(__dirname, "./src/shared") + "/",
};

export default defineConfig({
  define: {
    "process.env.NODE_ENV": '"test"',
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [path.resolve(__dirname, "./tests/setup.ts")],
    include: [
      "tests/backend/ipc/handlers/channel-handlers.test.ts",
      "tests/backend/ipc/handlers/storage-handlers.test.ts",
      "tests/backend/ipc/handlers/stream-handlers.test.ts",
    ],
    alias: sourceAliases,
  },
  resolve: {
    alias: sourceAliases,
  },
});
