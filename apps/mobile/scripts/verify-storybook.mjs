import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

async function source(file) {
  return ts.createSourceFile(
    file,
    await readFile(path.join(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

function initializer(file, name) {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(file) !== name) continue;
      let value = declaration.initializer;
      while (
        value &&
        (ts.isSatisfiesExpression(value) || ts.isAsExpression(value))
      )
        value = value.expression;
      assert(value, `${name} has no initializer`);
      return value;
    }
  }
  throw new Error(`Missing source inventory ${name}`);
}

function objectEntries(value) {
  assert(
    ts.isObjectLiteralExpression(value),
    "Expected a source object inventory",
  );
  return value.properties.map((property) => {
    assert(ts.isPropertyAssignment(property), "Expected a property assignment");
    return [
      ts.isStringLiteral(property.name)
        ? property.name.text
        : property.name.getText(),
      property.initializer,
    ];
  });
}

const index = JSON.parse(
  await readFile(path.join(root, "dist/storybook/index.json"), "utf8"),
);
const coverage = await source(
  "src/features/design-preview/domain/story-coverage.ts",
);
const routes = objectEntries(
  initializer(
    await source("src/features/shell/domain/shell-navigation.ts"),
    "SHELL_ROUTES",
  ),
).map(([id]) => id);
const settings = initializer(
  await source("src/features/settings/domain/settings-categories.ts"),
  "SETTINGS_CATEGORIES",
);
assert(
  ts.isArrayLiteralExpression(settings),
  "Expected settings category array",
);
const categories = settings.elements.map((entry) => {
  const id = objectEntries(entry).find(([name]) => name === "id")?.[1];
  assert(id && ts.isStringLiteral(id), "Expected category id");
  return id.text;
});
const components = (await readdir(path.join(root, "src/design")))
  .filter((file) => file.endsWith(".tsx") && !file.endsWith(".stories.tsx"))
  .map((file) => file.slice(0, -4));

const componentExports = [];
for (const component of components) {
  const file = await source(`src/design/${component}.tsx`);
  for (const statement of file.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      /^Mobile[A-Z]/.test(statement.name.text) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      componentExports.push(statement.name.text);
    }
  }
}
const desktopRoutes = [];
function visitDesktop(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText() === "createRoute"
  ) {
    const route = node.arguments[0];
    if (route && ts.isObjectLiteralExpression(route)) {
      const routePath = objectEntries(route).find(
        ([key]) => key === "path",
      )?.[1];
      if (routePath && ts.isStringLiteral(routePath))
        desktopRoutes.push(routePath.text);
    }
  }
  ts.forEachChild(node, visitDesktop);
}
visitDesktop(await source("../desktop/src/frontend/routes/router.tsx"));

for (const [name, expected] of [
  ["routeStoryCoverage", routes],
  ["settingsStoryCoverage", categories],
  ["componentStoryCoverage", components],
  ["componentExportStoryCoverage", componentExports],
  ["desktopRouteStoryCoverage", desktopRoutes],
]) {
  const entries = objectEntries(initializer(coverage, name));
  assert.deepEqual(
    entries.map(([id]) => id).sort(),
    expected.sort(),
    `${name} does not match current source`,
  );
  for (const [id, value] of entries) {
    assert(ts.isStringLiteral(value), `${name}.${id} must name a story`);
    assert.equal(
      index.entries[value.text]?.type,
      "story",
      `${name}.${id} is missing from the built catalog`,
    );
  }
}

const ledgerRoot = path.resolve(
  root,
  "../../docs/research/streamfusion-mobile/ui-integration",
);
const approvedIds = JSON.parse(
  await readFile(path.join(ledgerRoot, "approved-story-ids.json"), "utf8"),
);
const ledger = JSON.parse(
  await readFile(path.join(ledgerRoot, "runtime-ledger.json"), "utf8"),
);
assert.equal(
  approvedIds.length,
  160,
  "Approved inventory must contain 160 stories",
);
assert.equal(
  new Set(approvedIds).size,
  160,
  "Approved story IDs must be unique",
);
assert.deepEqual(
  ledger.map((row) => row.storyId).sort(),
  approvedIds,
  "Runtime ledger differs from the approved inventory",
);
for (const row of ledger) {
  assert.equal(
    index.entries[row.storyId]?.type,
    "story",
    `Approved story missing: ${row.storyId}`,
  );
  assert(
    row.productionOwner && row.stateOwner && row.operation,
    `Incomplete ownership: ${row.storyId}`,
  );
  await readFile(path.resolve(root, "../..", row.productionOwner), "utf8");
}
const stories = Object.values(index.entries).filter(
  (entry) => entry.type === "story",
);
assert(
  stories.some((entry) =>
    entry.title.startsWith("Android/Proposed/Moderation"),
  ),
  "Missing moderation proposals",
);
assert(
  stories.some((entry) =>
    entry.title.startsWith("Android/Proposed/Multistream"),
  ),
  "Missing multistream proposals",
);
console.log(
  `Storybook coverage passed. ${routes.length} mobile routes, ${desktopRoutes.length} desktop routes, ${categories.length} settings sections, ${components.length} shared presentation modules (${componentExports.length} components), ${stories.length} stories.`,
);
