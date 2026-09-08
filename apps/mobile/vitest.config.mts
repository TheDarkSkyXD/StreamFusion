import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const mobileRoot = path.dirname(fileURLToPath(import.meta.url));
const mobileRequire = createRequire(path.join(mobileRoot, "package.json"));
const reactRoot = path.dirname(mobileRequire.resolve("react/package.json"));
const reactDomRoot = path.dirname(mobileRequire.resolve("react-dom/package.json"));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@mobile", replacement: path.join(mobileRoot, "src") },
      { find: /^react$/, replacement: path.join(reactRoot, "index.js") },
      { find: /^react\/(.*)$/, replacement: path.join(reactRoot, "$1") },
      { find: /^react-dom$/, replacement: path.join(reactDomRoot, "index.js") },
      { find: /^react-dom\/(.*)$/, replacement: path.join(reactDomRoot, "$1") },
    ],
    dedupe: ["react", "react-dom"],
  },
  test: {
    include: ["src/features/**/tests/**/*.test.ts"],
  },
});
