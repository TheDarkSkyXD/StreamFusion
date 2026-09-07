import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

export const featureLayers = [
  "routes",
  "components",
  "domain",
  "capabilities",
  "adapters",
  "data",
  "utils",
  "composition",
  "tests",
];
const allowedLayers = {
  domain: ["domain", "capabilities", "utils"],
  capabilities: ["domain", "capabilities", "utils"],
  utils: ["domain", "capabilities", "utils"],
  data: ["domain", "capabilities", "utils", "data", "adapters"],
  adapters: ["domain", "capabilities", "utils", "data", "adapters"],
};
const pureLayers = new Set(["domain", "capabilities", "utils"]);
const nodeModules = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const normalize = (value) => value.split(path.sep).join("/");
const classify = (file) => {
  const match = normalize(file).match(/\/src\/(frontend|backend)\/features\/([^/]+)\/([^/]+)\//);
  return match ? { runtime: match[1], feature: match[2], layer: match[3] } : undefined;
};

function resolveImport(specifier, importer) {
  const sourceRoot = normalize(importer).split("/src/")[0] + "/src";
  const aliases = [
    ["@/", "frontend"],
    ["@frontend/", "frontend"],
    ["@backend/", "backend"],
    ["@shared/", "shared"],
  ];
  const alias = aliases.find(([prefix]) => specifier.startsWith(prefix));
  if (alias) return path.resolve(sourceRoot, alias[1], specifier.slice(alias[0].length));
  if (specifier.startsWith(".")) return path.resolve(path.dirname(importer), specifier);
  return undefined;
}

export function dependencyViolation(importer, specifier) {
  const from = classify(importer);
  const target = resolveImport(specifier, importer);
  const normalizedTarget = target ? normalize(target) : "";
  if (
    from?.layer === "tests" ||
    /[\\/]tests[\\/]/.test(importer) ||
    /\.stories\.[cm]?[jt]sx?$/.test(importer)
  )
    return undefined;
  if (
    /(?:^|\/)tests\//.test(normalizedTarget) ||
    /(?:\.test(?:-helpers)?\.|\.stories\.)/.test(specifier)
  ) {
    return "Production code cannot depend on tests or Storybook artifacts.";
  }
  if (
    normalize(importer).includes("/src/frontend/") &&
    normalizedTarget.includes("/src/backend/") &&
    !importer.endsWith("electron.d.ts")
  ) {
    return "Renderer code must use shared contracts and renderer adapters, not backend implementations.";
  }
  if (
    normalize(importer).includes("/src/backend/") &&
    normalizedTarget.includes("/src/frontend/")
  ) {
    return "Backend code cannot depend on the renderer.";
  }
  if (!from) return undefined;
  const to = target ? classify(target + "/") : undefined;
  if (to && allowedLayers[from.layer] && !allowedLayers[from.layer].includes(to.layer)) {
    return `${from.layer} cannot depend on ${to.layer}; depend on an application-owned capability instead.`;
  }
  if (pureLayers.has(from.layer)) {
    if (!target && !specifier.startsWith("@streamfusion/core/") && !["zod"].includes(specifier)) {
      return `${from.layer} must remain independent of concrete libraries and runtime APIs.`;
    }
    if (target && !to && !normalizedTarget.includes("/src/shared/")) {
      return `${from.layer} may only use feature contracts, pure helpers, and shared process-neutral code.`;
    }
  }
  if (from.runtime === "frontend" && (nodeModules.has(specifier) || specifier === "electron")) {
    return "Renderer features cannot import Node or Electron.";
  }
  return undefined;
}

export const featureArchitecturePlugin = {
  rules: {
    dependencies: {
      meta: { type: "problem", schema: [], messages: { boundary: "{{reason}}" } },
      create(context) {
        const owner = classify(context.filename);
        const directBridgeForbidden =
          owner?.runtime === "frontend" &&
          ["routes", "components", "domain", "capabilities", "utils"].includes(owner.layer);
        const checkBridgeAccess = (node) => {
          if (!directBridgeForbidden) return;
          const object = node.type === "TSQualifiedName" ? node.left : node.object;
          const property = node.type === "TSQualifiedName" ? node.right : node.property;
          if (
            object?.type === "Identifier" &&
            object.name === "window" &&
            ((property?.type === "Identifier" && property.name === "electronAPI") ||
              (property?.type === "Literal" && property.value === "electronAPI"))
          ) {
            context.report({
              node,
              messageId: "boundary",
              data: {
                reason:
                  "Feature UI and pure code must use a typed capability; access the desktop bridge in an adapter.",
              },
            });
          }
        };
        const check = (node) => {
          if (typeof node.value !== "string") return;
          const reason = dependencyViolation(context.filename, node.value);
          if (reason) context.report({ node, messageId: "boundary", data: { reason } });
        };
        return {
          MemberExpression: checkBridgeAccess,
          TSQualifiedName: checkBridgeAccess,
          ImportDeclaration: (node) => check(node.source),
          ExportNamedDeclaration: (node) => {
            if (node.source) check(node.source);
          },
          ExportAllDeclaration: (node) => check(node.source),
          ImportExpression: (node) => check(node.source),
          CallExpression: (node) => {
            if (
              node.callee.type === "Identifier" &&
              node.callee.name === "require" &&
              node.arguments[0]
            )
              check(node.arguments[0]);
          },
        };
      },
    },
  },
};

export function verifyFeatureLayout(sourceRoot) {
  const failures = [];
  const sourceDirectories = fs
    .readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (sourceDirectories.join(",") !== "backend,frontend,shared")
    failures.push("Desktop src must contain only backend, frontend, and shared source directories");
  for (const runtime of ["backend", "frontend"]) {
    const root = path.join(sourceRoot, runtime, "features");
    if (!fs.existsSync(root)) {
      failures.push(`Missing ${runtime} feature root`);
      continue;
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const feature = path.join(root, entry.name);
      const children = fs.readdirSync(feature, { withFileTypes: true });
      for (const layer of featureLayers) {
        if (!children.some((child) => child.name === layer && child.isDirectory()))
          failures.push(`${runtime}/${entry.name}: missing ${layer}/`);
      }
      for (const child of children) {
        if (child.isDirectory() && !featureLayers.includes(child.name))
          failures.push(`${runtime}/${entry.name}: unexpected ${child.name}/`);
        if (child.isFile() && !["AGENTS.md", "README.md"].includes(child.name))
          failures.push(
            `${runtime}/${entry.name}: implementation must live in a responsibility directory (${child.name})`
          );
      }
    }
  }
  const legacyPages = path.join(sourceRoot, "frontend", "pages");
  if (
    fs.existsSync(legacyPages) &&
    fs.readdirSync(legacyPages, { recursive: true }).some((file) => /\.[jt]sx?$/.test(file))
  )
    failures.push("Feature screens remain under frontend/pages");
  if (failures.length) throw new Error(failures.join("\n"));
}
