import tseslint from "typescript-eslint";

const consumerFiles = [
  "apps/**/*.{js,mjs,cjs,jsx,ts,tsx}",
  "packages/**/*.{js,mjs,cjs,jsx,ts,tsx}",
];
const productionFiles = [
  "apps/*/src/**/*.{js,mjs,cjs,jsx,ts,tsx}",
  "packages/*/src/**/*.{js,mjs,cjs,jsx,ts,tsx}",
];
const publicSubpaths = new Set([
  "platform",
  "content",
  "discovery",
  "follows",
  "auth",
  "chat",
  "activity",
  "reliability",
  "relay",
  "testing",
]);
const coreSourcePattern = /(^|\/)(packages\/)?core\/src(\/|$)/;

function staticSpecifier(node) {
  if (typeof node?.value === "string") {
    return node.value;
  }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked;
  }
  return undefined;
}

function violationFor(specifier, allowTesting) {
  const normalized = specifier.replaceAll("\\", "/");
  if (coreSourcePattern.test(normalized)) {
    return "Core internals are private; import a declared package subpath.";
  }
  if (normalized === "@streamfusion/core") {
    return "Import a declared @streamfusion/core subpath.";
  }
  const prefix = "@streamfusion/core/";
  if (!normalized.startsWith(prefix)) {
    return undefined;
  }
  const subpath = normalized.slice(prefix.length);
  if (!publicSubpaths.has(subpath)) {
    return "Import only a declared @streamfusion/core subpath.";
  }
  if (!allowTesting && subpath === "testing") {
    return "Production code must not import core test support.";
  }
  return undefined;
}

const coreImportBoundary = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { allowTesting: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const [{ allowTesting = false } = {}] = context.options;

    function check(node) {
      const specifier = staticSpecifier(node);
      const message = specifier && violationFor(specifier, allowTesting);
      if (message) {
        context.report({ node, message });
      }
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require"
        ) {
          check(node.arguments[0]);
        }
      },
    };
  },
};

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
    plugins: {
      streamfusion: {
        rules: {
          "core-import-boundary": coreImportBoundary,
        },
      },
    },
    rules: {
      "streamfusion/core-import-boundary": ["error", { allowTesting: true }],
    },
  },
  {
    files: productionFiles,
    rules: {
      "streamfusion/core-import-boundary": ["error", { allowTesting: false }],
    },
  },
);
