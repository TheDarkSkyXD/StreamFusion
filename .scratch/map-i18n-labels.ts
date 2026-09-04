import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";

const byValue = new Map<string, string[]>();
const localeRoot = "apps/desktop/src/frontend/i18n/locales/en";

function unwrap(node: ts.Expression): ts.Expression {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return unwrap(node.expression);
  }
  return node;
}

function collectObject(node: ts.ObjectLiteralExpression, prefix = "") {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
      ? property.name.text
      : null;
    if (!name) continue;
    const path = prefix ? `${prefix}.${name}` : name;
    const initializer = unwrap(property.initializer);
    if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
      const paths = byValue.get(initializer.text) ?? [];
      paths.push(path);
      byValue.set(initializer.text, paths);
    } else if (ts.isObjectLiteralExpression(initializer)) {
      collectObject(initializer, path);
    }
  }
}

for (const filename of readdirSync(localeRoot).filter((name) => name.endsWith(".ts") && name !== "index.ts")) {
  const source = ts.createSourceFile(filename, readFileSync(`${localeRoot}/${filename}`, "utf8"), ts.ScriptTarget.Latest, true);
  source.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (!declaration.initializer) continue;
      const initializer = unwrap(declaration.initializer);
      if (ts.isObjectLiteralExpression(initializer)) collectObject(initializer);
    }
  });
}
const report = execFileSync(
  process.execPath,
  ["scripts/check-i18n-coverage.mjs", "--report"],
  { cwd: "apps/desktop", encoding: "utf8" }
);

for (const line of report.split("\n")) {
  const match = /^(.*?):(\d+):(\d+)\tattribute:label\t(.+)$/.exec(line);
  if (!match) continue;
  const value = JSON.parse(match[4]) as string;
  console.log(`${match[1]}:${match[2]}\t${JSON.stringify(value)}\t${byValue.get(value)?.join(",") ?? "MISSING"}`);
}
