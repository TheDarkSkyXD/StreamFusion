import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import ts from "typescript";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = dirname(scriptPath);
const defaultRepositoryRoot = resolve(scriptDirectory, "..", "..", "..");
const factKinds = new Set([
  "route",
  "renderer-feature",
  "ipc-feature",
  "ipc-handler",
  "platform-endpoint",
  "state-store",
]);
const sourceInventoryCache = new Map();

function toSourcePath(repositoryRoot, absolutePath) {
  return relative(repositoryRoot, absolutePath).split(sep).join("/");
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (
        entry.isDirectory() &&
        [".git", ".scratch", "node_modules", "dist", "out", ".vite", "release"].includes(entry.name)
      ) {
        return [];
      }
      return entry.isDirectory() ? walkFiles(path) : [path];
    })
    .sort((left, right) => left.localeCompare(right));
}

function addFact(facts, fact) {
  if (!factKinds.has(fact.kind)) {
    throw new Error(`Unsupported discovered fact kind: ${fact.kind}`);
  }
  if (facts.some((candidate) => candidate.id === fact.id)) {
    throw new Error(`Duplicate discovered fact ID: ${fact.id}`);
  }
  facts.push(fact);
}

function propertyName(property) {
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    return property.name.text;
  return null;
}

function stringProperty(object, name) {
  const property = object.properties.find(
    (candidate) => ts.isPropertyAssignment(candidate) && propertyName(candidate) === name
  );
  return property && ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)
    ? property.initializer.text
    : null;
}

function unwrappedExpression(expression) {
  let current = expression;
  while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function discoverAstFacts({ repositoryRoot, routerPath, ipcChannelsPath }) {
  const program = ts.createProgram([routerPath, ipcChannelsPath], {
    allowJs: true,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.ESNext,
  });
  const facts = [];
  const routerSource = program.getSourceFile(routerPath);
  const ipcSource = program.getSourceFile(ipcChannelsPath);
  if (!routerSource || !ipcSource)
    throw new Error("Could not load the Desktop route and IPC sources");

  const visitRouter = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "createRoute" &&
      node.arguments.length > 0 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const path = stringProperty(node.arguments[0], "path");
      if (path) {
        addFact(facts, {
          id: `route:${path}`,
          kind: "route",
          sourcePath: toSourcePath(repositoryRoot, routerPath),
          symbol: path,
        });
      }
    }
    ts.forEachChild(node, visitRouter);
  };
  visitRouter(routerSource);

  const visitIpc = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "IPC_FEATURES" &&
      node.initializer &&
      ts.isObjectLiteralExpression(unwrappedExpression(node.initializer))
    ) {
      const initializer = unwrappedExpression(node.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) return;
      for (const property of initializer.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.initializer))
          continue;
        const name = propertyName(property);
        if (!name) continue;
        addFact(facts, {
          id: `ipc-feature:${property.initializer.text}`,
          kind: "ipc-feature",
          sourcePath: toSourcePath(repositoryRoot, ipcChannelsPath),
          symbol: name,
        });
      }
    }
    ts.forEachChild(node, visitIpc);
  };
  visitIpc(ipcSource);
  return facts;
}

function discoverFacts(repositoryRoot) {
  const desktopRoot = join(repositoryRoot, "apps/desktop");
  const frontendRoot = join(desktopRoot, "src/frontend");
  const backendRoot = join(desktopRoot, "src/backend");
  const facts = discoverAstFacts({
    repositoryRoot,
    routerPath: join(frontendRoot, "routes/router.tsx"),
    ipcChannelsPath: join(desktopRoot, "src/shared/ipc-channels.ts"),
  });

  for (const entry of readdirSync(join(frontendRoot, "features"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    addFact(facts, {
      id: `renderer-feature:${entry.name}`,
      kind: "renderer-feature",
      sourcePath: `apps/desktop/src/frontend/features/${entry.name}`,
      symbol: entry.name,
    });
  }

  const handlersDirectory = join(backendRoot, "ipc/handlers");
  for (const path of walkFiles(handlersDirectory)) {
    const name = basename(path);
    if (!name.endsWith("-handlers.ts")) continue;
    addFact(facts, {
      id: `ipc-handler:${name.slice(0, -".ts".length)}`,
      kind: "ipc-handler",
      sourcePath: toSourcePath(repositoryRoot, path),
      symbol: name,
    });
  }

  for (const platform of ["twitch", "kick"]) {
    const endpointsDirectory = join(backendRoot, `api/platforms/${platform}/endpoints`);
    for (const path of walkFiles(endpointsDirectory)) {
      if (extname(path) !== ".ts") continue;
      const name = basename(path, ".ts");
      addFact(facts, {
        id: `platform-endpoint:${platform}:${name}`,
        kind: "platform-endpoint",
        sourcePath: toSourcePath(repositoryRoot, path),
        symbol: name,
      });
    }
  }

  const storePaths = [
    ...walkFiles(join(frontendRoot, "store")),
    ...walkFiles(join(frontendRoot, "features")).filter((path) => /store[^/]*\.tsx?$/.test(path)),
    ...walkFiles(join(frontendRoot, "hooks")).filter((path) => /store[^/]*\.tsx?$/.test(path)),
  ].filter((path) => /store[^/]*\.tsx?$/.test(path));
  for (const path of [...new Set(storePaths)].sort((left, right) => left.localeCompare(right))) {
    const sourcePath = toSourcePath(repositoryRoot, path);
    addFact(facts, {
      id: `state-store:${sourcePath.replace("apps/desktop/src/frontend/", "").replace(/\.tsx?$/, "")}`,
      kind: "state-store",
      sourcePath,
      symbol: basename(path, extname(path)),
    });
  }

  return facts.sort((left, right) => left.id.localeCompare(right.id));
}

function parseManualLedger(manualLedger) {
  if (!manualLedger || typeof manualLedger !== "object" || Array.isArray(manualLedger)) {
    throw new Error("The manual Desktop parity ledger must be an object");
  }
  if (manualLedger.schemaVersion !== 1)
    throw new Error("The manual ledger must use schemaVersion 1");
  if (!Array.isArray(manualLedger.capabilities))
    throw new Error("The manual ledger needs capabilities");
  if (!Array.isArray(manualLedger.ignoredFacts))
    throw new Error("The manual ledger needs ignoredFacts");
  return manualLedger;
}

function parseJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function matchingFiles(paths, pattern) {
  const normalized = pattern.replaceAll("\\", "/");
  const escaped = normalized
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replaceAll("**/", "__DOUBLE_STAR_SLASH__")
    .replaceAll("**", "__DOUBLE_STAR__")
    .replaceAll("*", "[^/]*")
    .replaceAll("__DOUBLE_STAR_SLASH__", "(?:.*/)?")
    .replaceAll("__DOUBLE_STAR__", ".*");
  const expression = new RegExp(`^${escaped}$`);
  return paths.filter((path) => expression.test(path));
}

function assertUnique(values, description) {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length > 0)
    throw new Error(`Duplicate ${description}: ${[...new Set(duplicates)].join(", ")}`);
}

function validateInventory({ repositoryRoot, repositoryFiles, facts, manualLedger }) {
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  assertUnique(
    facts.map((fact) => fact.id),
    "discovered fact IDs"
  );
  assertUnique(
    manualLedger.capabilities.map((capability) => capability.id),
    "capability IDs"
  );
  assertUnique(
    manualLedger.ignoredFacts.map((ignoredFact) => ignoredFact.factId),
    "ignored fact IDs"
  );
  const mappedFactIds = new Set();

  for (const capability of manualLedger.capabilities) {
    if (
      typeof capability.id !== "string" ||
      typeof capability.area !== "string" ||
      typeof capability.outcome !== "string" ||
      !Array.isArray(capability.entry)
    ) {
      throw new Error("Every capability needs id, area, outcome, and entry");
    }
    for (const field of [
      "renderer",
      "electronBoundary",
      "mainProcess",
      "platformBranches",
      "state",
      "persistence",
      "verification",
    ]) {
      if (!Array.isArray(capability[field]))
        throw new Error(`Capability ${capability.id} has no ${field} references`);
    }
    for (const field of [
      "renderer",
      "electronBoundary",
      "mainProcess",
      "platformBranches",
      "state",
    ]) {
      for (const factId of capability[field]) {
        if (typeof factId !== "string" || !factsById.has(factId)) {
          throw new Error(`Capability ${capability.id} references missing fact ${factId}`);
        }
        mappedFactIds.add(factId);
      }
    }
    for (const persistencePath of capability.persistence) {
      if (
        typeof persistencePath !== "string" ||
        !existsSync(join(repositoryRoot, persistencePath))
      ) {
        throw new Error(
          `Capability ${capability.id} references missing persistence path ${persistencePath}`
        );
      }
    }
    for (const verificationPath of capability.verification) {
      if (
        typeof verificationPath !== "string" ||
        matchingFiles(repositoryFiles, verificationPath).length === 0
      ) {
        throw new Error(
          `Capability ${capability.id} verification pattern matches no files: ${verificationPath}`
        );
      }
    }
  }

  for (const ignoredFact of manualLedger.ignoredFacts) {
    if (
      typeof ignoredFact.factId !== "string" ||
      typeof ignoredFact.reason !== "string" ||
      !ignoredFact.reason ||
      !factsById.has(ignoredFact.factId)
    ) {
      throw new Error(`Ignored fact ${ignoredFact.factId} must exist and include a reason`);
    }
    mappedFactIds.add(ignoredFact.factId);
  }
  const unmapped = facts.filter((fact) => !mappedFactIds.has(fact.id));
  if (unmapped.length > 0) {
    throw new Error(`Discovered facts are unmapped: ${unmapped.map((fact) => fact.id).join(", ")}`);
  }
}

function normalizeCapability(capability) {
  const fields = [
    "entry",
    "renderer",
    "electronBoundary",
    "mainProcess",
    "platformBranches",
    "state",
    "persistence",
    "verification",
  ];
  const normalized = { id: capability.id, area: capability.area, outcome: capability.outcome };
  for (const field of fields) normalized[field] = [...(capability[field] ?? [])].sort();
  return normalized;
}

function markdownFor(inventory) {
  const factsById = new Map(inventory.facts.map((fact) => [fact.id, fact]));
  const evidenceLabels = new Set([
    "Renderer evidence",
    "Electron boundary",
    "Main-process evidence",
    "Platform branches",
    "State evidence",
  ]);
  const lines = [
    "# Desktop parity inventory",
    "",
    "This report is generated by `npm --prefix apps/desktop run parity:desktop:write`.",
    "Run `npm --prefix apps/desktop run parity:desktop:check` to detect drift without writing.",
    "",
    `Discovered structural facts: ${inventory.facts.length}.`,
    `User-facing capabilities: ${inventory.capabilities.length}.`,
    "",
  ];
  for (const capability of inventory.capabilities) {
    lines.push(`## ${capability.area}: ${capability.outcome}`, "", `ID: \`${capability.id}\`.`, "");
    for (const [label, values] of [
      ["Entry", capability.entry],
      ["Renderer evidence", capability.renderer],
      ["Electron boundary", capability.electronBoundary],
      ["Main-process evidence", capability.mainProcess],
      ["Platform branches", capability.platformBranches],
      ["State evidence", capability.state],
      ["Persistence", capability.persistence],
      ["Verification", capability.verification],
    ]) {
      lines.push(`### ${label}`, "");
      const evidence = values.map((value) => {
        const fact = factsById.get(value);
        return evidenceLabels.has(label) && fact
          ? `- \`${value}\` in \`${fact.sourcePath}\`.`
          : `- \`${value}\``;
      });
      lines.push(...(evidence.length > 0 ? evidence : ["- None."]), "");
    }
  }
  lines.push("## Explicitly ignored structural facts", "");
  if (inventory.ignoredFacts.length === 0) {
    lines.push("- None.");
  } else {
    for (const ignoredFact of inventory.ignoredFacts) {
      lines.push(`- \`${ignoredFact.factId}\`. ${ignoredFact.reason}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function buildInventory(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? defaultRepositoryRoot);
  const manualPath = resolve(
    options.manualPath ??
      join(repositoryRoot, "apps/desktop/scripts/desktop-parity-capabilities.json")
  );
  const manualLedger = parseManualLedger(options.manualLedger ?? parseJson(manualPath));
  let sourceInventory = sourceInventoryCache.get(repositoryRoot);
  if (!sourceInventory) {
    sourceInventory = {
      facts: discoverFacts(repositoryRoot),
      repositoryFiles: walkFiles(repositoryRoot).map((path) => toSourcePath(repositoryRoot, path)),
    };
    sourceInventoryCache.set(repositoryRoot, sourceInventory);
  }
  validateInventory({ repositoryRoot, manualLedger, ...sourceInventory });
  const inventory = {
    schemaVersion: 1,
    facts: sourceInventory.facts,
    capabilities: manualLedger.capabilities
      .map(normalizeCapability)
      .sort((left, right) => left.id.localeCompare(right.id)),
    ignoredFacts: [...manualLedger.ignoredFacts].sort((left, right) =>
      left.factId.localeCompare(right.factId)
    ),
  };
  const markdown = markdownFor(inventory);
  if (options.checkReportPath) {
    const reportPath = resolve(options.checkReportPath);
    const committedMarkdown = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "";
    if (committedMarkdown !== markdown) {
      throw new Error("Desktop parity inventory is out of date. Run parity:desktop:write.");
    }
  }
  return { inventory, markdown };
}

function run() {
  const mode = process.argv[2];
  if (mode !== "write" && mode !== "check") {
    throw new Error("Usage: node scripts/desktop-parity-inventory.mjs <write|check>");
  }
  const reportPath = resolve(
    process.env.STREAMFUSION_PARITY_REPORT_PATH ??
      join(defaultRepositoryRoot, "docs/research/streamfusion-mobile/desktop-parity-inventory.md")
  );
  const { markdown } = buildInventory({
    checkReportPath: mode === "check" ? reportPath : undefined,
  });
  if (mode === "write") {
    writeFileSync(reportPath, markdown, "utf8");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) run();
