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
      {
        find: "@desktop-i18n",
        replacement: path.join(mobileRoot, "../desktop/src/frontend/i18n"),
      },
      {
        find: "@streamfusion/core/display-language",
        replacement: path.join(mobileRoot, "../../packages/core/src/display-language/index.ts"),
      },
      {
        find: "@streamfusion/core/settings",
        replacement: path.join(mobileRoot, "../../packages/core/src/settings/index.ts"),
      },
      { find: /^react$/, replacement: path.join(reactRoot, "index.js") },
      { find: /^react\/(.*)$/, replacement: path.join(reactRoot, "$1") },
      { find: /^react-dom$/, replacement: path.join(reactDomRoot, "index.js") },
      { find: /^react-dom\/(.*)$/, replacement: path.join(reactDomRoot, "$1") },
      {
        find: "expo-haptics",
        replacement: path.join(mobileRoot, "src/design/tests/expo-haptics-stub.ts"),
      },
      {
        find: "react-native",
        replacement: path.join(mobileRoot, "src/test-support/react-native-stub.cjs"),
      },
      {
        find: "expo-crypto",
        replacement: path.join(mobileRoot, "src/test-support/expo-crypto-stub.cjs"),
      },
      {
        find: "expo",
        replacement: path.join(mobileRoot, "src/test-support/expo-stub.cjs"),
      },
      {
        find: "@react-native-community/slider",
        replacement: path.join(mobileRoot, "src/test-support/slider-stub.cjs"),
      },
    ],
    dedupe: ["react", "react-dom"],
  },
  test: {
    setupFiles: [path.join(mobileRoot, "src/test-support/vitest.setup.ts")],
    // These panel suites still pull Flow-typed RN community packages under Vite.
    // Keep them out of Release Verify until a dedicated RN transform is wired.
    exclude: [
      "src/features/ad-blocking/tests/adblock-settings-panel.test.ts",
      "src/features/ad-blocking/tests/twitch-playlist-proxy-settings-panel.test.ts",
      "src/features/connectivity/tests/proxy-settings-panel.test.ts",
    ],
    include: [
      "src/design/**/*.test.ts",
      "src/features/**/tests/**/*.test.ts",
      "src/i18n/**/*.test.ts",
      "src/i18n/tests/**/*.test.ts",
    ],
  },
});