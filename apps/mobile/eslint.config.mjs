import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";
import boundaries from "eslint-plugin-boundaries";

const productionFiles = ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"];
const mobileLayers = [
  "mobile-entry",
  "mobile-feature",
  "mobile-design",
  "mobile-foundation",
  "mobile-capability",
  "mobile-transport",
  "mobile-adapter",
  "mobile-persistence",
  "mobile-native",
  "mobile-composition",
];
const publicCoreSubpaths = [
  "platform",
  "content",
  "discovery",
  "follows",
  "auth",
  "chat",
  "activity",
  "reliability",
  "relay",
];
const coreConsumers = [
  "mobile-feature",
  "mobile-capability",
  "mobile-transport",
  "mobile-adapter",
  "mobile-persistence",
  "mobile-native",
  "mobile-composition",
];
const productionRestrictions = [
  {
    group: ["@streamfusion/core/testing", "@streamfusion/core/src/**"],
    message: "Use a declared production @streamfusion/core subpath.",
  },
  {
    group: [
      "node:*",
      "electron",
      "electron/**",
      "../../desktop/**",
      "../../../desktop/**",
      "../../worker/**",
      "../../../worker/**",
      "../../integration-relay/**",
      "../../../integration-relay/**",
      "../../tests/**",
      "../../../tests/**",
    ],
    message:
      "Mobile production code must use public core contracts and Mobile-owned runtime boundaries.",
  },
];
const frameworkRestrictions = {
  patterns: [
    ...productionRestrictions,
    {
      group: [
        "react",
        "react/**",
        "react-native",
        "react-native/**",
        "expo",
        "expo-constants",
        "expo-file-system",
        "expo-notifications",
        "expo-secure-store",
        "expo-sqlite",
      ],
      message:
        "Framework and device APIs belong in Mobile UI, persistence, or native bridges.",
    },
  ],
};

export default defineConfig([
  ...expoConfig,
  {
    ignores: ["android/**", "dist/**", ".expo/**"],
  },
  {
    files: ["vitest.config.mts"],
  },
  {
    files: productionFiles,
    plugins: { boundaries },
    settings: {
      "import/resolver": {
        alias: {
          map: [["@mobile", "./src"]],
          extensions: [".ts", ".tsx"],
        },
      },
      "boundaries/elements": [
        { type: "mobile-entry", pattern: "app", partialMatch: false },
        {
          type: "mobile-feature",
          pattern: "src/features",
          partialMatch: false,
        },
        {
          type: "mobile-design",
          pattern: "src/design",
          partialMatch: false,
        },
        {
          type: "mobile-foundation",
          pattern: "src/foundations",
          partialMatch: false,
        },
        {
          type: "mobile-capability",
          pattern: "src/capabilities",
          partialMatch: false,
        },
        {
          type: "mobile-transport",
          pattern: "src/transport",
          partialMatch: false,
        },
        {
          type: "mobile-adapter",
          pattern: "src/adapters",
          partialMatch: false,
        },
        {
          type: "mobile-persistence",
          pattern: "src/persistence",
          partialMatch: false,
        },
        {
          type: "mobile-native",
          pattern: "src/native",
          partialMatch: false,
        },
        {
          type: "mobile-composition",
          pattern: "src/composition",
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
              from: { element: { types: { anyOf: mobileLayers } } },
              allow: { to: { module: { origin: "external" } } },
            },
            ...publicCoreSubpaths.map((subpath) => ({
              from: { element: { types: { anyOf: coreConsumers } } },
              allow: {
                dependency: { source: `@streamfusion/core/${subpath}` },
              },
            })),
            {
              from: { element: { type: "mobile-entry" } },
              allow: {
                to: {
                  element: {
                    types: { anyOf: ["mobile-entry", "mobile-composition"] },
                  },
                },
              },
            },
            {
              from: { element: { type: "mobile-feature" } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        "mobile-feature",
                        "mobile-design",
                        "mobile-capability",
                        "mobile-foundation",
                      ],
                    },
                  },
                },
              },
            },
            {
              from: { element: { type: "mobile-design" } },
              allow: {
                to: {
                  element: {
                    types: { anyOf: ["mobile-design", "mobile-foundation"] },
                  },
                },
              },
            },
            {
              from: { element: { type: "mobile-foundation" } },
              allow: { to: { element: { type: "mobile-foundation" } } },
            },
            {
              from: { element: { type: "mobile-capability" } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: ["mobile-capability", "mobile-foundation"],
                    },
                  },
                },
              },
            },
            {
              from: { element: { type: "mobile-transport" } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        "mobile-transport",
                        "mobile-capability",
                        "mobile-foundation",
                      ],
                    },
                  },
                },
              },
            },
            {
              from: { element: { type: "mobile-native" } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        "mobile-native",
                        "mobile-capability",
                        "mobile-foundation",
                      ],
                    },
                  },
                },
              },
            },
            {
              from: { element: { type: "mobile-adapter" } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        "mobile-adapter",
                        "mobile-transport",
                        "mobile-native",
                        "mobile-capability",
                        "mobile-foundation",
                      ],
                    },
                  },
                },
              },
            },
            {
              from: { element: { type: "mobile-persistence" } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        "mobile-persistence",
                        "mobile-native",
                        "mobile-capability",
                        "mobile-foundation",
                      ],
                    },
                  },
                },
              },
            },
            {
              from: { element: { type: "mobile-composition" } },
              allow: {
                to: { element: { types: { anyOf: mobileLayers } } },
              },
            },
          ],
        },
      ],
      "no-restricted-imports": ["error", { patterns: productionRestrictions }],
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...productionRestrictions,
            {
              group: [
                "@streamfusion/core/**",
                "expo-constants",
                "expo-file-system",
                "expo-notifications",
                "expo-secure-store",
                "expo-sqlite",
                "tmi.js",
                "pusher-js",
                "twitch-gql-queries",
              ],
              message:
                "Route declarations call the Mobile composition root instead of concrete runtime dependencies.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/capabilities/**/*.{ts,tsx}",
      "src/foundations/**/*.{ts,tsx}",
      "src/transport/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": ["error", frameworkRestrictions],
    },
  },
  {
    files: ["src/persistence/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...productionRestrictions,
            {
              group: [
                "react",
                "react/**",
                "react-native",
                "react-native/**",
                "expo-router",
                "expo-router/**",
                "tmi.js",
                "pusher-js",
                "twitch-gql-queries",
              ],
              message:
                "Persistence owns storage implementations, not UI or provider integrations.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/adapters/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...productionRestrictions,
            {
              group: [
                "react",
                "react/**",
                "react-native",
                "react-native/**",
                "expo",
                "expo-constants",
                "expo-file-system",
                "expo-notifications",
                "expo-secure-store",
                "expo-sqlite",
              ],
              message:
                "Adapters consume Mobile native bridges instead of UI or native frameworks directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...productionRestrictions,
            {
              group: [
                "expo-constants",
                "expo-file-system",
                "expo-notifications",
                "expo-secure-store",
                "expo-sqlite",
                "../../modules/**",
                "../../../modules/**",
              ],
              message:
                "Feature UI and controllers consume capabilities instead of concrete native APIs.",
            },
            {
              group: ["tmi.js", "pusher-js", "twitch-gql-queries"],
              message:
                "Feature UI and controllers consume application ports instead of provider SDKs.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["tests/**/*.{ts,tsx,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@streamfusion/core/src/**"],
              message: "Tests use declared @streamfusion/core subpaths.",
            },
          ],
        },
      ],
    },
  },
]);
