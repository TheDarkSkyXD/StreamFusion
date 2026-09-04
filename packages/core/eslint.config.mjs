import js from "@eslint/js";
import { builtinModules } from "node:module";
import prettier from "eslint-config-prettier";
import boundaries from "eslint-plugin-boundaries";
import globals from "globals";
import tseslint from "typescript-eslint";

const productionFiles = ["src/**/*.ts"];
const typedFiles = [...productionFiles];
const toolingFiles = ["tests/*.mjs", "scripts/*.mjs", "eslint.config.mjs"];
const publicSubpaths = [
  "platform",
  "content",
  "discovery",
  "follows",
  "auth",
  "chat",
  "reliability",
  "relay",
];
const coreElements = [
  "core-foundation",
  "core-capability",
  "core-use-case",
  "core-public",
  "core-testing",
];
const runtimeImportRestrictions = [
  ...new Set(
    builtinModules.flatMap((name) => [
      name,
      name.startsWith("node:") ? name : `node:${name}`,
    ]),
  ),
  "electron",
  "expo",
  "react",
  "react-native",
  "@cloudflare/workers-types",
  "axios",
  "better-sqlite3",
  "ky",
  "pusher-js",
  "tmi.js",
  "twitch-gql-queries",
].map((name) => ({
  name,
  message:
    "Core must use application-owned contracts instead of runtime or provider APIs.",
}));

export default tseslint.config(
  {
    ignores: ["dist/**"],
  },
  {
    ...js.configs.recommended,
    files: [...typedFiles, ...toolingFiles],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: typedFiles,
  })),
  {
    files: toolingFiles,
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: typedFiles,
    plugins: {
      boundaries,
    },
    settings: {
      "import/resolver": {
        alias: {
          map: [["@core", "./src"]],
          extensions: [".ts"],
        },
      },
      "boundaries/elements": [
        {
          type: "core-foundation",
          pattern: "src/foundations",
          partialMatch: false,
        },
        {
          type: "core-capability",
          pattern: "src/capabilities",
          partialMatch: false,
        },
        {
          type: "core-use-case",
          pattern: "src/use-cases",
          partialMatch: false,
        },
        {
          type: "core-public",
          pattern: publicSubpaths.map((subpath) => `src/${subpath}`),
          partialMatch: false,
        },
        {
          type: "core-testing",
          pattern: "src/testing",
          partialMatch: false,
        },
        {
          type: "migration-shim",
          pattern: "src/migration-shims",
          partialMatch: false,
        },
      ],
    },
    rules: {
      "boundaries/no-unknown-files": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          checkAllOrigins: true,
          checkUnknownLocals: true,
          checkInternals: true,
          policies: [
            {
              from: { element: { type: "core-foundation" } },
              allow: { to: { element: { type: "core-foundation" } } },
            },
            {
              from: { element: { type: "core-capability" } },
              allow: {
                to: {
                  element: {
                    types: { anyOf: ["core-capability", "core-foundation"] },
                  },
                },
              },
            },
            {
              from: { element: { type: "core-use-case" } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        "core-use-case",
                        "core-capability",
                        "core-foundation",
                      ],
                    },
                  },
                },
              },
            },
            {
              from: { element: { type: "core-public" } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        "core-public",
                        "core-use-case",
                        "core-capability",
                        "core-foundation",
                      ],
                    },
                  },
                },
              },
            },
            {
              from: { element: { type: "core-testing" } },
              allow: {
                to: { element: { types: { anyOf: coreElements } } },
              },
            },
          ],
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: runtimeImportRestrictions,
          patterns: [
            {
              group: [
                "apps/**",
                "../apps/**",
                "../../apps/**",
                "../../../apps/**",
                "../../../../apps/**",
                "../../../../../apps/**",
              ],
              message: "Core must not import application source.",
            },
            {
              group: ["@streamfusion/core/testing", "**/testing/**"],
              message: "Production core code must not import test support.",
            },
            {
              group: ["**/migration-shim/**", "**/migration-shims/**"],
              message: "Production core code must not import migration shims.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
