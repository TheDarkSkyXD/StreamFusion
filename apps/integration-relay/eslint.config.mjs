import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import boundaries from "eslint-plugin-boundaries";
import globals from "globals";
import tseslint from "typescript-eslint";

const productionFiles = ["src/**/*.ts"];
const typedFiles = [...productionFiles, "tests/**/*.ts"];
const toolingFiles = [
  "scripts/*.mjs",
  "eslint.config.mjs",
  "vitest.config.mts"
];

const publicCoreRestrictions = [
  {
    group: ["@streamfusion/core/testing", "@streamfusion/core/src/**"],
    message: "Use a declared production @streamfusion/core subpath."
  }
];

const relaySourceRestrictions = [
  ...publicCoreRestrictions,
  {
    group: [
      "electron",
      "electron/**",
      "expo",
      "expo/**",
      "react",
      "react/**",
      "react-native",
      "react-native/**",
      "firebase-admin",
      "firebase-admin/**",
      "@aws-sdk/**",
      "better-sqlite3",
      "better-sqlite3/**",
      "../../mobile/**",
      "../../../mobile/**",
      "../../desktop/**",
      "../../../desktop/**",
      "../../worker/**",
      "../../../worker/**"
    ],
    message:
      "Relay source may use public core contracts; app source and concrete provider SDKs require an explicit adapter layer."
  }
];

export default tseslint.config(
  {
    ignores: [".wrangler/**", "coverage/**", "dist/**"]
  },
  {
    ...js.configs.recommended,
    files: [...typedFiles, ...toolingFiles],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: "latest",
      sourceType: "module"
    }
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: typedFiles
  })),
  {
    files: toolingFiles,
    languageOptions: {
      globals: globals.node
    }
  },
  {
    files: productionFiles,
    plugins: {
      boundaries
    },
    settings: {
      "import/resolver": {
        alias: {
          map: [],
          extensions: [".ts"]
        }
      },
      "boundaries/elements": [
        {
          type: "relay-transport",
          pattern: "src/transport",
          partialMatch: false
        },
        {
          type: "relay-composition",
          pattern: "src/composition",
          partialMatch: false
        }
      ]
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
              from: { element: { type: "relay-transport" } },
              allow: { to: { element: { type: "relay-transport" } } }
            },
            {
              from: { element: { type: "relay-transport" } },
              allow: {
                dependency: {
                  source: "@streamfusion/core/relay"
                }
              }
            },
            {
              from: { element: { type: "relay-composition" } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: ["relay-composition", "relay-transport"]
                    }
                  }
                }
              }
            }
          ]
        }
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: relaySourceRestrictions
        }
      ]
    }
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: publicCoreRestrictions
        }
      ]
    }
  },
  prettier
);
