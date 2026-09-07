import path from "node:path";
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

const source = ["src/**/*.ts"];
const layers = ["routes", "components", "domain", "capabilities", "adapters", "data", "utils", "composition", "tests"];
const allowed = {
  entry: ["composition"],
  routes: ["routes", "domain", "capabilities", "adapters", "utils"],
  domain: ["domain", "capabilities", "utils"],
  capabilities: ["capabilities", "utils"],
  adapters: ["adapters", "domain", "capabilities", "utils"],
  data: ["data", "capabilities", "utils"],
  utils: ["utils"],
  composition: layers.filter((layer) => layer !== "tests"),
  tests: ["entry", ...layers.filter((layer) => layer !== "tests")]
};

function specifierOf(node) {
  if (typeof node?.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked;
  return undefined;
}

function layerOf(file) {
  const normalized = file.split(path.sep).join("/");
  if (normalized.endsWith("/src/index.ts")) return "entry";
  const match = normalized.match(/\/src\/features\/[^/]+\/([^/]+)\//);
  return match?.[1];
}

function boundaryViolation(importer, specifier) {
  const from = layerOf(importer);
  if (!from) return undefined;
  if (!specifier.startsWith(".")) {
    return ["domain", "capabilities", "utils"].includes(from) && !specifier.startsWith("@streamfusion/core/")
      ? `${from} must not import runtime libraries or SDKs.`
      : undefined;
  }
  const target = path.resolve(path.dirname(importer), specifier);
  const to = layerOf(`${target}/`);
  if (to === "tests" && from !== "tests") return "Production code cannot import feature tests.";
  if (to && !allowed[from]?.includes(to)) return `${from} cannot import ${to}.`;
  return undefined;
}

const workerBoundaryPlugin = {
  rules: {
    dependencies: {
      meta: { type: "problem", schema: [], messages: { boundary: "{{reason}}" } },
      create(context) {
        const check = (node) => {
          const specifier = specifierOf(node);
          const reason = specifier && boundaryViolation(context.filename, specifier);
          if (reason) context.report({ node, messageId: "boundary", data: { reason } });
        };
        return {
          ImportDeclaration: (node) => check(node.source),
          ExportNamedDeclaration: (node) => node.source && check(node.source),
          ExportAllDeclaration: (node) => check(node.source),
          ImportExpression: (node) => check(node.source),
          CallExpression: (node) => { if (node.callee.type === "Identifier" && node.callee.name === "require") check(node.arguments[0]); }
        };
      }
    }
  }
};

export default tseslint.config(
  { files: [...source, "scripts/*.mjs", "eslint.config.mjs", "vitest.config.mts"] },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: source })),
  {
    files: source,
    plugins: { boundaries, "worker-boundary": workerBoundaryPlugin },
    settings: { "boundaries/elements": [{ type: "worker-entry", pattern: "src/index.ts", mode: "file" }, ...layers.map((layer) => ({ type: `worker-${layer}`, pattern: `src/features/*/${layer}`, partialMatch: false }))] },
    rules: {
      "boundaries/no-unknown-files": "error",
      "worker-boundary/dependencies": "error"
    }
  }
);
