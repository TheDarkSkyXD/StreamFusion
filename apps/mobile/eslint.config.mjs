import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";
import boundaries from "eslint-plugin-boundaries";

const productionFiles = ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"];
const featureLayers = ["mobile-routes", "mobile-components", "mobile-domain", "mobile-capabilities", "mobile-adapters", "mobile-data", "mobile-utils", "mobile-feature-composition"];
const coreSubpaths = ["platform", "content", "discovery", "follows", "auth", "chat", "activity", "reliability", "relay"];
const restrictedRuntimeImports = [{ group: ["@streamfusion/core/testing", "@streamfusion/core/src/**", "node:*", "electron", "electron/**", "../../desktop/**", "../../../desktop/**", "../../worker/**", "../../../worker/**", "../../integration-relay/**", "../../../integration-relay/**"], message: "Mobile code uses public Core contracts and Mobile feature boundaries." }];

export default defineConfig([
  ...expoConfig,
  { files: ["vitest.config.mts"] },
  { ignores: ["android/**", "dist/**", ".expo/**"] },
  {
    files: productionFiles,
    plugins: { boundaries },
    settings: {
      "import/resolver": { alias: { map: [["@mobile", "./src"]], extensions: [".ts", ".tsx"] } },
      "boundaries/elements": [
        { type: "mobile-entry", pattern: "app", partialMatch: false },
        { type: "mobile-design", pattern: "src/design", partialMatch: false },
        { type: "mobile-runtime-composition", pattern: "src/composition", partialMatch: false },
        ...["routes", "components", "domain", "capabilities", "adapters", "data", "utils", "composition", "tests"].map((layer) => ({ type: `mobile-${layer === "composition" ? "feature-composition" : layer}`, pattern: `src/features/*/${layer}`, partialMatch: false }))
      ]
    },
    rules: {
      "boundaries/no-unknown-files": "error",
      "boundaries/dependencies": ["error", { default: "disallow", checkAllOrigins: true, checkUnknownLocals: true, checkInternals: true, policies: [
        { from: { element: { types: { anyOf: ["mobile-entry", "mobile-design", "mobile-runtime-composition", ...featureLayers, "mobile-tests"] } } }, allow: { to: { module: { origin: "external" } } } },
        { from: { element: { types: { anyOf: ["mobile-entry"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-entry", "mobile-runtime-composition"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-runtime-composition", "mobile-feature-composition"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-entry", "mobile-design", "mobile-runtime-composition", ...featureLayers] } } } } },
        { from: { element: { types: { anyOf: ["mobile-routes"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-domain", "mobile-capabilities", "mobile-utils"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-components"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-components", "mobile-domain", "mobile-capabilities", "mobile-utils", "mobile-design"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-domain"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-domain", "mobile-capabilities", "mobile-utils"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-capabilities"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-capabilities", "mobile-utils"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-adapters"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-adapters", "mobile-domain", "mobile-capabilities", "mobile-data", "mobile-utils"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-data"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-data", "mobile-capabilities", "mobile-utils"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-utils"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-utils"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-tests"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-entry", "mobile-design", "mobile-runtime-composition", ...featureLayers] } } } } },
        ...coreSubpaths.map((subpath) => ({ from: { element: { types: { anyOf: ["mobile-runtime-composition", ...featureLayers] } } }, allow: { dependency: { source: `@streamfusion/core/${subpath}` } } }))
      ] }],
      "no-restricted-imports": ["error", { patterns: restrictedRuntimeImports }]
    }
  },
  { files: ["src/features/**/domain/**/*.{ts,tsx}", "src/features/**/capabilities/**/*.{ts,tsx}", "src/features/**/utils/**/*.{ts,tsx}"], rules: { "no-restricted-imports": ["error", { patterns: [...restrictedRuntimeImports, { group: ["react", "react/**", "react-native", "react-native/**", "expo", "expo/**"], message: "Framework APIs belong in components, routes, or adapters." }] }] } },
  { files: ["src/features/**/tests/**/*.{ts,tsx,mjs}", "tests/**/*.{ts,tsx,mjs}"], rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["@streamfusion/core/src/**"], message: "Tests use declared Core subpaths." }] }] } }
]);
