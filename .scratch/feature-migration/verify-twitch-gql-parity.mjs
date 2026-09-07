import fs from "node:fs";
import ts from "typescript";

const manifest = JSON.parse(fs.readFileSync(".scratch/feature-migration/twitch-gql-extraction-manifest.json", "utf8"));
const parse = (name, source) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
const before = parse("before.ts", fs.readFileSync(".scratch/feature-migration/twitch-gql-before-extraction.ts.txt", "utf8"));
const printer = ts.createPrinter({ removeComments: true });
const normalize = (node, file) => printer.printNode(ts.EmitHint.Unspecified, node, file).replace(/^export\s+/, "").replace(/\s/g, "");
const nameOf = (node, file) => node.name?.text ?? (ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.getText(file) : undefined);
const original = new Map(before.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => [nameOf(node, before), normalize(node, before)]));
for (const owner of Object.keys(manifest.paths)) {
  const file = parse(owner + ".ts", fs.readFileSync(manifest.paths[owner], "utf8"));
  for (const node of file.statements) {
    if (ts.isImportDeclaration(node)) continue;
    const name = nameOf(node, file);
    if (original.get(name) !== normalize(node, file)) throw new Error(`Changed declaration: ${name}`);
    original.delete(name);
  }
}
if (JSON.stringify([...original.keys()].sort()) !== JSON.stringify([...manifest.deletedUnusedFunctions].sort())) {
  throw new Error(`Unexpected declaration omissions: ${[...original.keys()]}`);
}
const suites = (file) => file.statements.filter((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(file) === "describe");
const testBefore = parse("tests-before.ts", fs.readFileSync(".scratch/feature-migration/twitch-gql-tests-before-extraction.ts.txt", "utf8"));
const expectedSuites = new Map(suites(testBefore).map((node) => [node.expression.arguments[0].text, normalize(node, testBefore)]));
const suiteCount = expectedSuites.size;
for (const path of Object.values(manifest.testPaths)) {
  const file = parse(path, fs.readFileSync(path, "utf8"));
  for (const node of suites(file)) {
    const title = node.expression.arguments[0].text;
    if (expectedSuites.get(title) !== normalize(node, file)) throw new Error(`Changed or duplicated suite: ${title}`);
    expectedSuites.delete(title);
  }
}
if (expectedSuites.size) throw new Error(`Missing suites: ${[...expectedSuites.keys()]}`);
const evidence = { unchangedDeclarations: manifest.assignments.length, unchangedSuites: suiteCount, removedUnusedFunctions: [...original.keys()], transportExports: ["MAX_QUERIES_PER_REQUEST", "gqlRequest", "sendPersistedQuery"] };
fs.writeFileSync(".scratch/feature-migration/twitch-gql-parity-evidence.json", JSON.stringify(evidence, null, 2));
console.log(evidence);
