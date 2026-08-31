import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

const routeImportRestrictions = {
  patterns: [
    {
      group: [
        "node:*",
        "electron",
        "electron/**",
        "../src/adapters/**",
        "../src/persistence/**",
        "../src/transport/**",
        "../modules/**",
        "@streamfusion/core/testing",
        "@streamfusion/core/src/**",
        "@streamfusion/core/*/**",
      ],
      message:
        "Route declarations may use Mobile features and public core exports, not runtime adapters or package internals.",
    },
  ],
};

export default defineConfig([
  ...expoConfig,
  {
    ignores: ["android/**", "dist/**", ".expo/**"],
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", routeImportRestrictions],
    },
  },
]);
