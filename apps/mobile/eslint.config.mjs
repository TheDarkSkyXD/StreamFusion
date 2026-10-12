import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import boundaries from "eslint-plugin-boundaries";
import globals from "globals";

const storybookFiles = [".storybook/**/*", "src/**/*.stories.tsx", "src/features/design-preview/**/*.{ts,tsx}"];
const productionFiles = ["index.js", "src/**/*.{ts,tsx}", "modules/**/*.{ts,tsx}"];
const featureLayers = ["mobile-routes", "mobile-components", "mobile-domain", "mobile-capabilities", "mobile-adapters", "mobile-data", "mobile-utils", "mobile-feature-composition"];
const coreSubpaths = ["platform", "content", "discovery", "follows", "auth", "chat", "activity", "reliability", "relay", "media-jobs", "local-captions", "display-language", "settings"];
const restrictedRuntimeImports = [{ group: ["@streamfusion/core/testing", "@streamfusion/core/src/**", "node:*", "electron", "electron/**", "../../desktop/**", "../../../desktop/**", "../../worker/**", "../../../worker/**", "../../integration-relay/**", "../../../integration-relay/**"], message: "Mobile code uses public Core contracts and Mobile feature boundaries." }];
const nativeBridgeImports = [{ group: ["expo-modules-core", "expo-modules-core/**", "expo-web-browser", "react-native/Libraries/BatchedBridge/NativeModules", "react-native/Libraries/BatchedBridge/NativeModules/**", "react-native/Libraries/TurboModule/TurboModuleRegistry", "react-native/Libraries/TurboModule/TurboModuleRegistry/**"], message: "Only feature adapters and local native modules may access native bridge SDKs." }, { group: ["expo"], importNames: ["requireNativeModule", "requireOptionalNativeModule"], message: "Only feature adapters and local native modules may access native bridge SDKs." }, { group: ["react-native"], importNames: ["NativeModules", "TurboModuleRegistry"], message: "Only feature adapters and local native modules may access native bridge SDKs." }];
const nativeBridgeRestrictedFiles = ["app/**/*.{ts,tsx}", "src/composition/**/*.{ts,tsx}", ...["routes", "components", "domain", "capabilities", "data", "utils", "composition"].map((layer) => `src/features/**/${layer}/**/*.{ts,tsx}`)];

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["**/*.{ts,tsx,mts}"], languageOptions: { globals: { ...globals.browser, __DEV__: "readonly", process: "readonly" } }, rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }], "@typescript-eslint/no-require-imports": "off" } },
  { files: ["src/**/*.{ts,tsx}"], plugins: { "react-hooks": reactHooks }, rules: { "react-hooks/rules-of-hooks": "error" } },
  { files: ["**/*.{mjs,cjs,js,mts}"], languageOptions: { globals: globals.node }, rules: { "@typescript-eslint/no-require-imports": "off", "no-redeclare": ["error", { builtinGlobals: false }] } },
  { files: [".storybook/public/*.js"], languageOptions: { globals: globals.browser } },
  { files: ["src/features/shell/domain/app-link-parser.ts"], rules: { "no-control-regex": "off" } },
  { files: ["*.js", "scripts/*.cjs"], languageOptions: { sourceType: "commonjs" } },
  { files: ["vitest.config.mts"] },
  { files: ["native-config.cjs", "plugins/**/*.{js,cjs,mjs}"], languageOptions: { sourceType: "commonjs", globals: globals.node } },
  { ignores: ["android/**", "modules/**/android/build/**", "dist/**", ".expo/**"] },
  {
    files: [...productionFiles, ".storybook/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "import/resolver": { alias: { map: [["@mobile", "./src"], ["@desktop-i18n", "../desktop/src/frontend/i18n"]], extensions: [".ts", ".tsx", ".json"] } },
      "boundaries/files": [
        { category: "storybook", pattern: storybookFiles, exclusive: true },
        { category: "mobile-entry", pattern: "index.js", exclusive: true },
        { category: "production", pattern: productionFiles }
      ],
      "boundaries/elements": [
        { type: "mobile-design", pattern: "src/design", partialMatch: false },
        { type: "mobile-runtime-composition", pattern: "src/composition", partialMatch: false },
        { type: "mobile-i18n", pattern: "src/i18n", partialMatch: false },
        { type: "mobile-native-module", pattern: "modules/*/src", partialMatch: false },
        { type: "mobile-tests", pattern: "src/test-support", partialMatch: false },
        ...["routes", "components", "domain", "capabilities", "adapters", "data", "utils", "composition", "tests"].map((layer) => ({ type: `mobile-${layer === "composition" ? "feature-composition" : layer}`, pattern: `src/features/*/${layer}`, partialMatch: false }))
      ]
    },
    rules: {
      "boundaries/no-unknown-files": "error",
      "boundaries/dependencies": ["error", { default: "disallow", checkAllOrigins: true, checkUnknownLocals: true, checkInternals: true, policies: [
        { from: { file: { categories: "mobile-entry" } }, allow: { to: [{ module: { origin: "external" } }, { element: { types: "mobile-runtime-composition" } }] } },
        { from: { element: { types: "mobile-tests" } }, allow: { to: { file: { categories: "mobile-entry" } } } },
        { from: { file: { path: ".storybook/main.ts" } }, allow: { dependency: { source: "node:url" } } },
        { from: { file: { categories: "storybook" } }, allow: { to: { module: { origin: "external" } } } },
        { from: { file: { categories: "storybook" } }, allow: { to: { file: { categories: "storybook" } } } },
        { from: { file: { categories: "storybook" } }, allow: { to: { element: { types: { anyOf: ["mobile-design", "mobile-components", "mobile-domain", "mobile-capabilities", "mobile-utils", "mobile-i18n"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-entry", "mobile-design", "mobile-runtime-composition", "mobile-i18n", "mobile-native-module", ...featureLayers, "mobile-tests"] } } }, allow: { to: { module: { origin: "external" } } } },
        { from: { element: { types: { anyOf: ["mobile-entry"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-entry", "mobile-runtime-composition"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-design"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-design"] } } } } },
        { from: { file: { path: "src/design/haptics.ts" } }, allow: { to: { element: { types: { anyOf: ["mobile-native-module"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-runtime-composition", "mobile-feature-composition"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-entry", "mobile-design", "mobile-runtime-composition", "mobile-i18n", ...featureLayers] } } } } },
        { from: { element: { types: { anyOf: ["mobile-i18n"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-i18n"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-components", "mobile-feature-composition", "mobile-runtime-composition", "mobile-tests"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-i18n"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-i18n"] } } }, allow: { dependency: { source: "@desktop-i18n" } } },
        { from: { element: { types: { anyOf: ["mobile-i18n"] } } }, allow: { dependency: { source: "@desktop-i18n/**" } } },
        { from: { element: { types: { anyOf: ["mobile-routes"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-components", "mobile-domain", "mobile-capabilities", "mobile-utils"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-components"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-components", "mobile-domain", "mobile-capabilities", "mobile-utils", "mobile-design"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-domain"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-domain", "mobile-capabilities", "mobile-utils"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-capabilities"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-capabilities", "mobile-utils"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-adapters"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-adapters", "mobile-domain", "mobile-capabilities", "mobile-data", "mobile-utils", "mobile-native-module"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-data"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-data", "mobile-capabilities", "mobile-utils"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-utils"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-utils"] } } } } },
        { from: { element: { types: { anyOf: ["mobile-tests"] } } }, allow: { to: { element: { types: { anyOf: ["mobile-entry", "mobile-design", "mobile-runtime-composition", ...featureLayers] } } } } },
        { from: { element: { types: { anyOf: ["mobile-tests"] } } }, allow: { dependency: { source: "node:fs" } } },
        { from: { element: { types: { anyOf: ["mobile-tests"] } } }, allow: { dependency: { source: "node:url" } } },
        ...coreSubpaths.map((subpath) => ({ from: { element: { types: { anyOf: ["mobile-runtime-composition", "mobile-i18n", ...featureLayers, "mobile-tests"] } } }, allow: { dependency: { source: `@streamfusion/core/${subpath}` } } })),
        { from: { file: { categories: "production" } }, disallow: { to: { file: { categories: "storybook" } } } }
      ] }],
      "no-restricted-imports": ["error", { patterns: restrictedRuntimeImports }]
    }
  },
  { files: [".storybook/main.ts"], rules: { "no-restricted-imports": "off" } },
  { files: nativeBridgeRestrictedFiles, rules: { "no-restricted-imports": ["error", { patterns: [...restrictedRuntimeImports, ...nativeBridgeImports] }], "no-restricted-syntax": ["error", { selector: "ImportDeclaration[source.value='expo'] ImportNamespaceSpecifier", message: "Only feature adapters and local native modules may access Expo native bridge APIs." }, { selector: "ImportDeclaration[source.value='react-native'] ImportNamespaceSpecifier", message: "Only feature adapters and local native modules may access React Native native bridge APIs." }] } },
  { files: ["src/features/**/domain/**/*.{ts,tsx}", "src/features/**/capabilities/**/*.{ts,tsx}", "src/features/**/utils/**/*.{ts,tsx}"], rules: { "no-restricted-imports": ["error", { patterns: [...restrictedRuntimeImports, ...nativeBridgeImports, { group: ["react", "react/**", "react-native", "react-native/**", "expo", "expo/**"], message: "Framework APIs belong in components, routes, or adapters." }] }] } },
  { files: ["src/features/**/tests/**/*.{ts,tsx,mjs}", "tests/**/*.{ts,tsx,mjs}"], rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["@streamfusion/core/src/**"], message: "Tests use declared Core subpaths." }] }] } }
]);
