import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const relayRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = path.resolve(relayRoot, "../..");
const roots = [relayRoot, path.join(repositoryRoot, "packages/core/src/relay")];
const ignoredDirectories = new Set([
  ".git",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules"
]);
const privateKeyMarker = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
const sensitiveAssignment = new RegExp(
  String.raw`(?:client[_-]?secret|api[_-]?token|private[_-]?key|fcm[_-]?credential|password)\s*[=:]\s*["'][^"'$\s][^"']{7,}["']`,
  "i"
);

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(target)));
    if (entry.isFile()) files.push(target);
  }
  return files;
}

const files = (await Promise.all(roots.map(collectFiles))).flat();
const findings = [];
for (const file of files) {
  const relative = path.relative(repositoryRoot, file);
  const fileName = path.basename(file);
  if (
    fileName === ".dev.vars" ||
    fileName.startsWith(".dev.vars.") ||
    fileName === ".env" ||
    fileName.startsWith(".env.")
  )
    findings.push(`${relative}: secret file`);

  const content = await readFile(file, "utf8");
  if (content.includes(privateKeyMarker))
    findings.push(`${relative}: private key material`);
  if (sensitiveAssignment.test(content))
    findings.push(`${relative}: plaintext credential`);
}

assert.deepEqual(findings, []);
console.log(`Secret boundary passed across ${files.length} relay-owned files.`);
