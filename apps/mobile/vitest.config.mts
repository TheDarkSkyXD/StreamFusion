import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const mobileRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@mobile": path.join(mobileRoot, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
