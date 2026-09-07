import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const cases = [["src/features/shell/capabilities/proof.ts", "export const proof = true;\n", true], ["src/features/shell/domain/proof.ts", 'import "../capabilities/proof";\n', true], ["src/features/shell/domain/proof-forbidden.ts", 'import "../adapters/proof";\n', false], ["src/features/shell/adapters/proof.ts", "export const proof = true;\n", true]];
const files = cases.map(([file]) => path.join(root, file));
try {
  for (const [file, source] of cases) { const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, source); }
  const eslint = new ESLint({ cwd: root, overrideConfigFile: path.join(root, "eslint.config.mjs") });
  for (const [file, , allowed] of cases) { const [result] = await eslint.lintFiles([path.join(root, file)]); assert.equal(result.messages.some((message) => message.ruleId === "boundaries/dependencies"), !allowed, `${file}: incorrect dependency decision`); }
  console.log("Feature architecture import proof passed.");
} finally { await Promise.all(files.map((file) => rm(file, { force: true }))); }
