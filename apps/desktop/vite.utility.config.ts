import { resolve } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "out/utility",
    emptyOutDir: true,
    target: "node20",
    sourcemap: process.env.NODE_ENV !== "production",
    ssr: resolve(__dirname, "src/backend/utility/caption-recognizer.ts"),
    rollupOptions: {
      external: ["sherpa-onnx-node"],
      output: {
        format: "cjs",
        entryFileNames: "caption-recognizer.cjs",
      },
    },
  },
});
