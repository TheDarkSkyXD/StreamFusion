import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const frontendDirectory = join(scriptDirectory, "../src/frontend");
const arguments_ = process.argv.slice(2);
const scopes = arguments_.flatMap((argument, index) =>
  argument === "--scope" && arguments_[index + 1]
    ? [arguments_[index + 1].replaceAll("\\", "/")]
    : []
);
const reportOnly = arguments_.includes("--report");
const summaryOnly = arguments_.includes("--summary-only");
const visibleAttributes = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "placeholder",
  "title",
]);
const presentationProperties = new Set([
  "ariaLabel",
  "description",
  "emptyMessage",
  "errorMessage",
  "heading",
  "label",
  "message",
  "placeholder",
  "successMessage",
  "title",
  "tooltip",
]);
const allowedLiterals = new Set([
  "<unserializable error>",
  "7TV",
  "Aa",
  "API",
  "AV1",
  "BTTV",
  "CPU",
  "Esc",
  "FFZ",
  "FFmpeg",
  "FPS",
  "GIF",
  "GPU",
  "HLS",
  "HEVC",
  "ID",
  "Kick",
  "MultiView",
  "OAuth",
  "PID",
  "RAM",
  "StreamFusion",
  "Twitch",
  "VOD",
  "ZW",
]);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          ["__fixtures__", "__tests__", "dev", "dev-relay", "fixtures", "tests"].includes(
            entry.name
          ) ||
          path.replaceAll("\\", "/").endsWith("/i18n/locales")
        ) {
          return [];
        }
        return collectSourceFiles(path);
      }
      if (
        ![".ts", ".tsx"].includes(extname(entry.name)) ||
        entry.name.endsWith(".d.ts") ||
        entry.name.includes(".stories.") ||
        entry.name.includes("story-fixtures") ||
        entry.name.includes(".test.")
      ) {
        return [];
      }
      return [path];
    })
  );
  return files.flat();
}

function normalizeLiteral(value) {
  return value.replace(/\s+/g, " ").trim();
}

function isTranslatable(value) {
  const normalized = normalizeLiteral(value);
  const visibleText = normalized.replace(/\{\{[^}]+\}\}/g, "");
  return (
    /\p{L}/u.test(visibleText) &&
    !/^\p{Lu}$/u.test(normalized) &&
    !/^\d+(?:\.\d+)?\s?(?:p|k|s|m|h|d)$/i.test(normalized) &&
    !/^\(?\{\{value\}\}(?:k|x)\)?$/i.test(normalized) &&
    !/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/.test(normalized) &&
    !(normalized.startsWith("!") && normalized.includes("text-")) &&
    !allowedLiterals.has(normalized) &&
    !/^https?:\/\//i.test(normalized)
  );
}

function expressionLiterals(expression) {
  if (!expression) return [];
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return [expression];
  }
  if (ts.isTemplateExpression(expression)) return [expression];
  if (ts.isParenthesizedExpression(expression)) return expressionLiterals(expression.expression);
  if (ts.isConditionalExpression(expression)) {
    return [
      ...expressionLiterals(expression.whenTrue),
      ...expressionLiterals(expression.whenFalse),
    ];
  }
  if (
    ts.isBinaryExpression(expression) &&
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(expression.operatorToken.kind)
  ) {
    return [...expressionLiterals(expression.left), ...expressionLiterals(expression.right)];
  }
  return [];
}

function literalValue(node) {
  if (!ts.isTemplateExpression(node)) return node.text;
  return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("{{value}}");
}

function propertyName(node) {
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  return undefined;
}

function isVisibleNotificationCall(node) {
  if (ts.isIdentifier(node.expression)) {
    return ["notifySettingsSaved", "setError", "setSuccess", "showToast", "toast"].includes(
      node.expression.text
    );
  }
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "toast"
  );
}

function isInsideTechnicalText(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (!ts.isJsxElement(current)) continue;
    const tagName = current.openingElement.tagName.getText();
    return ["code", "pre", "script", "style"].includes(tagName);
  }
  return false;
}

const findings = [];
for (const file of await collectSourceFiles(frontendDirectory)) {
  const relativeFile = relative(frontendDirectory, file).replaceAll("\\", "/");
  if (scopes.length > 0 && !scopes.some((scope) => relativeFile.startsWith(scope))) continue;
  const sourceText = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  function record(node, value, kind) {
    const normalized = normalizeLiteral(value);
    if (!isTranslatable(normalized)) return;
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({
      file: relativeFile,
      line: position.line + 1,
      column: position.character + 1,
      kind,
      value: normalized,
    });
  }

  function visit(node) {
    if (ts.isJsxText(node) && !ts.isJsxAttribute(node.parent) && !isInsideTechnicalText(node)) {
      record(node, node.text, "text");
    }

    if (
      ts.isJsxExpression(node) &&
      !ts.isJsxAttribute(node.parent) &&
      !isInsideTechnicalText(node)
    ) {
      for (const literal of expressionLiterals(node.expression)) {
        record(literal, literalValue(literal), "expression");
      }
    }

    if (ts.isJsxAttribute(node) && visibleAttributes.has(node.name.text)) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) {
        record(node.initializer, node.initializer.text, `attribute:${node.name.text}`);
      } else if (node.initializer && ts.isJsxExpression(node.initializer)) {
        for (const literal of expressionLiterals(node.initializer.expression)) {
          record(literal, literalValue(literal), `attribute:${node.name.text}`);
        }
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      presentationProperties.has(propertyName(node)) &&
      !isInsideTechnicalText(node)
    ) {
      for (const literal of expressionLiterals(node.initializer)) {
        record(literal, literalValue(literal), `property:${propertyName(node)}`);
      }
    }

    if (ts.isCallExpression(node) && isVisibleNotificationCall(node)) {
      for (const argument of node.arguments) {
        for (const literal of expressionLiterals(argument)) {
          record(literal, literalValue(literal), "notification");
        }
      }
    }

    if (
      extname(file) === ".tsx" &&
      ts.isCallExpression(node) &&
      ((ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "i18n" &&
        node.expression.name.text === "t") ||
        (ts.isElementAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "i18n" &&
          ts.isStringLiteral(node.expression.argumentExpression) &&
          node.expression.argumentExpression.text === "t"))
    ) {
      record(node.expression, "Direct i18n.t call", "nonreactive-translation");
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

findings.sort((left, right) =>
  left.file === right.file ? left.line - right.line : left.file.localeCompare(right.file)
);

if (!summaryOnly) {
  for (const finding of findings) {
    console.log(
      `${finding.file}:${finding.line}:${finding.column}\t${finding.kind}\t${JSON.stringify(finding.value)}`
    );
  }
}

console.log(`Untranslated renderer literals: ${findings.length}`);
if (findings.length > 0 && !reportOnly) process.exitCode = 1;
