import js from "@eslint/js";
import { builtinModules } from "node:module";
import prettier from "eslint-config-prettier";
import boundaries from "eslint-plugin-boundaries";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";
import tseslint from "typescript-eslint";

const sourceFiles = ["src/**/*.{js,mjs,cjs,jsx,ts,tsx}"];
const testFiles = ["tests/**/*.{js,mjs,cjs,jsx,ts,tsx}"];
const configFiles = ["*.config.{js,mjs,cjs,jsx,ts,tsx}"];
const lintFiles = [...sourceFiles, ...testFiles, ...configFiles];
const typedSourceFiles = ["src/**/*.{ts,tsx}"];
const typedFiles = [...typedSourceFiles, "tests/**/*.{ts,tsx}", "*.config.{ts,tsx}"];
const reactSourceFiles = ["src/**/*.{jsx,tsx}"];
const reactFiles = [...reactSourceFiles, "tests/**/*.{jsx,tsx}", "*.config.{jsx,tsx}"];
const nodeRuntimeImportRestrictions = [
  ...new Set(
    builtinModules.flatMap((name) => [name, name.startsWith("node:") ? name : `node:${name}`])
  ),
].map((name) => ({
  name,
  message: "IPC contracts must not depend on Node.js runtime APIs.",
}));
const rendererNodeRuntimeImportRestrictions = [
  ...new Set(
    builtinModules.flatMap((name) => [name, name.startsWith("node:") ? name : `node:${name}`])
  ),
].map((name) => ({
  name,
  message: "Frontend code must use the preload bridge instead of Node.js runtime APIs.",
}));
const coreImportRestrictionPatterns = [
  {
    group: ["@streamfusion/core/testing", "@streamfusion/core/src/**", "@streamfusion/core/*/**"],
    message:
      "Production code must import @streamfusion/core through a declared production subpath.",
  },
];
const rendererFeatureDependencies = {
  auth: ["moderation"],
  chat: ["auth", "discovery", "moderation", "settings", "shell"],
  discovery: ["chat", "multistream", "playback"],
  "media-library": ["discovery", "playback"],
  moderation: ["discovery", "shell"],
  multistream: ["chat", "discovery", "playback", "settings"],
  playback: ["auth", "chat", "discovery", "media-library", "settings"],
  settings: ["auth", "chat", "discovery", "multistream", "playback"],
  shell: ["auth", "discovery", "media-library", "multistream", "playback", "settings"],
};

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "out/**",
      "release/**",
      "coverage/**",
      ".vite/**",
      "storybook-static/**",
    ],
  },
  {
    ...js.configs.recommended,
    files: lintFiles,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: typedFiles,
  })),
  {
    files: typedFiles,
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: lintFiles,
    plugins: {
      "react-hooks": reactHooks,
      "unused-imports": unusedImports,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-unused-vars": "off",
      "prefer-const": "warn",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "warn",
    },
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...nodeRuntimeImportRestrictions,
            {
              name: "electron",
              message: "Shared code must remain independent of Electron runtimes.",
            },
            {
              name: "react",
              message: "Shared code must remain independent of frontend libraries.",
            },
            {
              name: "react-dom",
              message: "Shared code must remain independent of frontend libraries.",
            },
          ],
          patterns: [
            ...coreImportRestrictionPatterns,
            {
              group: [
                "@/**",
                "@backend/**",
                "@frontend/**",
                "../backend/**",
                "../frontend/**",
                "**/backend/**",
                "**/frontend/**",
                "react-*",
                "@radix-ui/**",
                "@tanstack/react-*/**",
                "lucide-react",
                "sonner",
              ],
              message: "Shared code must not depend on a process-specific application layer.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/shared/ipc-contracts/**/*.{ts,tsx}"],
    rules: {
      // IPC contracts must remain process-neutral so main and preload can share their types safely.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...nodeRuntimeImportRestrictions,
            {
              name: "electron",
              message: "IPC contracts must not depend on Electron runtime APIs.",
            },
            {
              name: "react",
              message: "IPC contracts must not depend on renderer UI libraries.",
            },
            {
              name: "react-dom",
              message: "IPC contracts must not depend on renderer UI libraries.",
            },
          ],
          patterns: [
            ...coreImportRestrictionPatterns,
            {
              group: [
                "node:*",
                "react-*",
                "@radix-ui/**",
                "@tanstack/react-*/**",
                "lucide-react",
                "sonner",
                "**/backend/**",
                "**/components/**",
                "**/hooks/**",
                "**/pages/**",
                "**/preload/**",
                "**/store/**",
                "../backend/**",
                "../components/**",
                "../hooks/**",
                "../pages/**",
                "../preload/**",
                "../store/**",
                "@/backend/**",
                "@/components/**",
                "@/hooks/**",
                "@/pages/**",
                "@/preload/**",
                "@/store/**",
                "../main",
                "../main.*",
                "@/main",
              ],
              message: "IPC contracts must not depend on a process-specific application layer.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/frontend/**/*.{ts,tsx}"],
    rules: {
      // Renderer code consumes contracts only through the typed window.electronAPI facade.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...rendererNodeRuntimeImportRestrictions,
            {
              name: "electron",
              message: "Frontend code must use the preload bridge instead of Electron directly.",
            },
          ],
          patterns: [
            ...coreImportRestrictionPatterns,
            {
              group: ["**/ipc-contracts/**", "@shared/ipc-contracts/**"],
              message:
                "Renderer code must use window.electronAPI instead of IPC contracts directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/backend/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              message: "Backend code must remain independent of frontend libraries.",
            },
            {
              name: "react-dom",
              message: "Backend code must remain independent of frontend libraries.",
            },
          ],
          patterns: [
            ...coreImportRestrictionPatterns,
            {
              group: ["react-*", "@radix-ui/**", "@tanstack/react-*/**", "lucide-react", "sonner"],
              message: "Backend code must remain independent of frontend libraries.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/frontend/features/**/*.{ts,tsx}"],
    plugins: {
      boundaries,
    },
    settings: {
      "import/resolver": {
        alias: {
          map: [
            ["@", "./src/frontend"],
            ["@backend", "./src/backend"],
            ["@frontend", "./src/frontend"],
            ["@shared", "./src/shared"],
          ],
          extensions: [".js", ".jsx", ".ts", ".tsx"],
        },
      },
      "boundaries/elements": Object.keys(rendererFeatureDependencies).map((feature) => ({
        type: feature,
        pattern: `src/frontend/features/${feature}`,
        partialMatch: false,
      })),
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: Object.entries(rendererFeatureDependencies).map(([from, allowed]) => ({
            from: { element: { type: from } },
            allow: { to: { element: { types: { anyOf: allowed } } } },
            message: `The ${from} feature may only depend on its declared feature collaborators.`,
          })),
        },
      ],
    },
  },
  {
    files: testFiles,
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
    rules: {
      // Electron and DOM test doubles intentionally collect callbacks with unrelated signatures.
      "@typescript-eslint/no-unsafe-function-type": "off",
    },
  },
  {
    files: ["src/frontend/features/playback/components/player/local-audio-capture-worklet.js"],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: "readonly",
        registerProcessor: "readonly",
      },
    },
  },
  {
    files: reactFiles,
    plugins: {
      react,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules,
      "react/display-name": "off",
      "react/no-array-index-key": "off",
      "react/no-unescaped-entities": "off",
      "react/prop-types": "off",
    },
  },
  prettier
);
