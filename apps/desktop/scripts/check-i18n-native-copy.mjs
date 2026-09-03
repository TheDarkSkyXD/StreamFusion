import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const backendDirectory = join(scriptDirectory, "../src/backend");
const visiblePropertyNames = new Set(["body", "buttons", "label", "message", "name", "title"]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : extname(entry.name) === ".ts" ? [path] : [];
    })
  );
  return files.flat();
}

function staticText(node) {
  if (ts.isStringLiteralLike(node)) return /\p{L}{2}/u.test(node.text);
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].some((text) =>
      /\p{L}{2}/u.test(text)
    );
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.some(staticText);
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some(
      (property) => ts.isPropertyAssignment(property) && staticText(property.initializer)
    );
  }
  return false;
}

function propertyName(property) {
  return property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ? property.name.text
    : null;
}

function visibleLiteral(node) {
  if (ts.isArrayLiteralExpression(node)) return node.elements.some(visibleLiteral);
  if (!ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = propertyName(property);
    if (name && visiblePropertyNames.has(name) && staticText(property.initializer)) return true;
    return visibleLiteral(property.initializer);
  });
}

function electronSurface(node) {
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    return node.expression.text === "Notification" ? node.arguments?.[0] : undefined;
  }
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
  const method = node.expression.name.text;
  if (method === "showErrorBox") return node.arguments.some(staticText) ? node : undefined;
  if (["buildFromTemplate", "showMessageBox", "showSaveDialog"].includes(method)) {
    return node.arguments.at(-1);
  }
}

const failures = [];
for (const path of await sourceFiles(backendDirectory)) {
  const source = await readFile(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node) => {
    const surface = electronSurface(node);
    const hasLiteral = surface === node ? true : surface && visibleLiteral(surface);
    if (hasLiteral) {
      const position = file.getLineAndCharacterOfPosition(node.getStart(file));
      failures.push(`${relative(backendDirectory, path)}:${position.line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

if (failures.length) {
  console.error("Hardcoded native Electron copy:\n" + failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Hardcoded native Electron copy: 0");
}
