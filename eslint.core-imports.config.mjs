import tseslint from "typescript-eslint";

const consumerFiles = [
  "apps/**/*.{js,mjs,cjs,jsx,ts,tsx}",
  "packages/**/*.{js,mjs,cjs,jsx,ts,tsx}",
];
const productionFiles = [
  "apps/*/src/**/*.{js,mjs,cjs,jsx,ts,tsx}",
  "packages/*/src/**/*.{js,mjs,cjs,jsx,ts,tsx}",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/coverage/**",
      "**/storybook-static/**",
    ],
  },
  {
    files: consumerFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@streamfusion/core",
              message: "Import a declared @streamfusion/core subpath.",
            },
          ],
          patterns: [
            {
              regex: "(^|/)(packages/)?core/src(/|$)",
              message:
                "Core internals are private; import a declared package subpath.",
            },
            {
              regex:
                "^@streamfusion/core/(?!platform$|content$|discovery$|auth$|chat$|reliability$|relay$|testing$)",
              message: "Import only a declared @streamfusion/core subpath.",
            },
          ],
        },
      ],
    },
  },
  {
    files: productionFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@streamfusion/core",
              message:
                "Import a declared @streamfusion/core production subpath.",
            },
            {
              name: "@streamfusion/core/testing",
              message: "Production code must not import core test support.",
            },
          ],
          patterns: [
            {
              regex: "(^|/)(packages/)?core/src(/|$)",
              message:
                "Core internals are private; import a declared package subpath.",
            },
            {
              regex:
                "^@streamfusion/core/(?!platform$|content$|discovery$|auth$|chat$|reliability$|relay$)",
              message:
                "Import only a declared @streamfusion/core production subpath.",
            },
          ],
        },
      ],
    },
  },
);
