import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";

const files = process.argv.slice(2);

for (const file of files) {
  const source = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const replacements = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "translateSettings"
    ) {
      if (node.arguments.length < 1 || node.arguments.length > 2) {
        throw new Error(`Unexpected translateSettings arity in ${file}: ${node.getText(sourceFile)}`);
      }
      const key = node.arguments[0].getText(sourceFile);
      const options = node.arguments[1]?.getText(sourceFile);
      replacements.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        text: options
          ? `translateSettings({ key: ${key}, options: ${options} })`
          : `translateSettings({ key: ${key} })`,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  let output = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
  }
  await writeFile(file, output, "utf8");
}
