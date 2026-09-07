import fs from "node:fs";
import ts from "typescript";

const sourcePath = "apps/desktop/src/backend/api/platforms/twitch/twitch-gql-client.ts";
if (fs.existsSync("apps/desktop/src/backend/features/discovery/adapters/twitch/twitch-gql-discovery.ts")) {
  throw new Error("GraphQL split already exists; use verify-twitch-gql-parity.mjs to verify it.");
}
const source = fs.readFileSync(sourcePath, "utf8");
fs.writeFileSync(".scratch/feature-migration/twitch-gql-before-extraction.ts.txt", source);
const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
const transportNames = new Set([
  "classifyGqlErrorForHealth", "GQL_ENDPOINT", "GQL_CLIENT_ID", "MAX_QUERIES_PER_REQUEST",
  "GQL_REQUEST_TIMEOUT_MS", "GqlQuery", "GqlResponses", "ValidGqlEnvelope", "isGqlError",
  "hasValidGqlEnvelope", "gqlRequest", "sendPersistedQuery",
]);
const playbackNames = new Set([
  "gqlGetVideosByChannel", "gqlGetClipsByChannel", "gqlGetPlaybackAccessToken",
  "gqlGetVodAccessToken", "gqlGetClipAccessToken", "gqlGetVideoMetadata", "gqlFetchGamesForVideos",
]);
const deadNames = new Set(["gqlGetChannelsByLogins", "gqlGetUserIdByLogin"]);
const output = { transport: [], discovery: [], playback: [] };
const imports = file.statements.filter(ts.isImportDeclaration).map((node) => node.getText(file)
  .replaceAll('"../../unified/platform-health"', '"@backend/api/unified/platform-health"')
  .replaceAll('"../../../../shared/platform-types"', '"@shared/platform-types"')
  .replaceAll('"./twitch-types"', '"@backend/api/platforms/twitch/twitch-types"')).join("\n");
const assignments = [];
for (const node of file.statements) {
  if (ts.isImportDeclaration(node)) continue;
  const name = node.name?.text ?? (ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.getText(file) : undefined);
  if (!name) throw new Error(`Unnamed declaration: ${node.getText(file).slice(0, 80)}`);
  if (deadNames.has(name)) continue;
  const owner = transportNames.has(name) ? "transport" : playbackNames.has(name) ? "playback" : "discovery";
  let text = node.getFullText(file).trim();
  if (["gqlRequest", "sendPersistedQuery", "MAX_QUERIES_PER_REQUEST"].includes(name)) {
    text = text.replace(node.getText(file), "export " + node.getText(file));
  }
  output[owner].push(text);
  assignments.push({ name, owner });
}
const paths = {
  transport: sourcePath,
  discovery: "apps/desktop/src/backend/features/discovery/adapters/twitch/twitch-gql-discovery.ts",
  playback: "apps/desktop/src/backend/features/playback/adapters/twitch/twitch-gql-playback.ts",
};
for (const owner of Object.keys(output)) {
  const transportImport = owner === "transport" ? "" : '\nimport { gqlRequest, sendPersistedQuery, MAX_QUERIES_PER_REQUEST } from "@backend/api/platforms/twitch/twitch-gql-client";\n';
  fs.writeFileSync(paths[owner], imports + transportImport + "\n\n" + output[owner].join("\n\n") + "\n");
}

const testPath = "apps/desktop/tests/backend/api/platforms/twitch/twitch-gql-client.test.ts";
const testSource = fs.readFileSync(testPath, "utf8");
fs.writeFileSync(".scratch/feature-migration/twitch-gql-tests-before-extraction.ts.txt", testSource);
const testFile = ts.createSourceFile(testPath, testSource, ts.ScriptTarget.Latest, true);
const suites = { transport: [], discovery: [], playback: [] };
const helpers = new Map();
const prelude = [];
for (const node of testFile.statements) {
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(testFile) === "describe") {
    const title = node.expression.arguments[0].text;
    const owner = /^(gqlRequest|sendPersistedQuery)/.test(title) ? "transport" : [...playbackNames].some((name) => title.startsWith(name)) ? "playback" : "discovery";
    suites[owner].push(node.getFullText(testFile));
  } else if (ts.isFunctionDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
    helpers.set(node.name.text, node.getFullText(testFile));
  } else if (ts.isImportDeclaration(node) && node.moduleSpecifier.text.endsWith("/twitch-gql-client")) {
    const imported = node.importClause.namedBindings.elements;
    for (const owner of ["discovery", "playback"]) {
      const names = imported.filter((n) => playbackNames.has(n.name.text) === (owner === "playback"));
      const target = `@backend/features/${owner}/adapters/twitch/twitch-gql-${owner}`;
      prelude.push(`import { ${names.map((n) => n.getText(testFile)).join(", ")} } from "${target}";`);
    }
  } else {
    prelude.push(node.getFullText(testFile));
  }
}
const testPaths = {
  transport: testPath,
  discovery: "apps/desktop/src/backend/features/discovery/tests/api/platforms/twitch/twitch-gql-discovery.test.ts",
  playback: "apps/desktop/src/backend/features/playback/tests/api/platforms/twitch/twitch-gql-playback.test.ts",
};
for (const owner of Object.keys(suites)) {
  const used = new Set();
  let text = suites[owner].join("\n");
  let added;
  do {
    added = false;
    for (const [name, helper] of helpers) {
      if (!used.has(name) && new RegExp(`\\b${name}\\b`).test(text)) {
        used.add(name);
        text += helper;
        added = true;
      }
    }
  } while (added);
  fs.writeFileSync(testPaths[owner], prelude.join("\n") + "\n" + [...helpers].filter(([name]) => used.has(name)).map(([, text]) => text).join("\n") + "\n" + suites[owner].join("\n"));
}
fs.writeFileSync(".scratch/feature-migration/twitch-gql-extraction-manifest.json", JSON.stringify({ assignments, deletedUnusedFunctions: [...deadNames], paths, testPaths, suiteCounts: Object.fromEntries(Object.entries(suites).map(([owner, nodes]) => [owner, nodes.length])) }, null, 2));
console.log(`Split ${assignments.length} declarations and ${Object.values(suites).reduce((n, suite) => n + suite.length, 0)} test suites.`);
