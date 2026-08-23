import js from "@eslint/js";
import { builtinModules } from "node:module";
import prettier from "eslint-config-prettier";
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
    files: ["src/ipc-contracts/**/*.{ts,tsx}"],
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
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/pages/**/*.{ts,tsx}",
      "src/providers/**/*.{ts,tsx}",
      "src/renderer/**/*.{ts,tsx}",
      "src/routes/**/*.{ts,tsx}",
      "src/slot-renderer/**/*.{ts,tsx}",
      "src/store/**/*.{ts,tsx}",
      "src/App.tsx",
      "src/renderer.tsx",
    ],
    rules: {
      // Renderer code consumes contracts only through the typed window.electronAPI facade.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ipc-contracts/**", "@/ipc-contracts/**"],
              message:
                "Renderer code must use window.electronAPI instead of IPC contracts directly.",
            },
          ],
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
    files: ["src/components/player/local-audio-capture-worklet.js"],
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
