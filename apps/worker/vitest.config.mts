import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/features/**/tests/**/*.test.ts"],
  },
});
