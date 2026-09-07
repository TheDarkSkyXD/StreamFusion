import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const cases = [
  ["src/features/kick-oauth/capabilities/proof.ts", "export const proof = true;\n", true],
  ["src/features/kick-oauth/domain/proof.ts", 'import "../capabilities/proof";\n', true],
  ["src/features/kick-oauth/domain/proof-relative.ts", 'import "../adapters/proof";\n', false],
  ["src/features/kick-oauth/domain/proof-dynamic.ts", 'await import("../adapters/proof");\n', false],
  ["src/features/kick-oauth/domain/proof-runtime.ts", 'import "firebase-admin";\n', false],
  ["src/features/kick-oauth/adapters/proof.ts", "export const proof = true;\n", true],
  ["src/features/kick-oauth/routes/proof.ts", 'import "../composition/proof";\n', false],
  ["src/features/kick-oauth/composition/proof.ts", "export const proof = true;\n", true],
  ["src/features/kick-oauth/components/proof.ts", 'import "../tests/proof";\n', false],
  ["src/features/kick-oauth/tests/proof.ts", "export const proof = true;\n", true]
];
const files = cases.map(([file]) => path.join(root, file));
try {
  for (const [file, source] of cases) { const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, source); }
  const eslint = new ESLint({ cwd: root, overrideConfigFile: path.join(root, "eslint.config.mjs") });
  for (const [file, , allowed] of cases) { const [result] = await eslint.lintFiles([path.join(root, file)]); assert.equal(result.messages.some((message) => message.ruleId === "worker-boundary/dependencies"), !allowed, `${file}: incorrect dependency decision`); }
  console.log("Worker feature architecture import proof passed.");
} finally { await Promise.all(files.map((file) => rm(file, { force: true }))); }
