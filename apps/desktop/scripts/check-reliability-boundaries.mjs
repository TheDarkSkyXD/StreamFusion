import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const ipcRoot = join(desktopRoot, "src", "backend", "ipc");
const contractRoot = join(desktopRoot, "src", "shared", "ipc-contracts");

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function sourceWithoutComments(path) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

const problems = [];
let directHandles = 0;
let trustedRoutes = 0;
let guardedLegacyRoutes = 0;

for (const path of listFiles(ipcRoot).filter((path) => extname(path) === ".ts")) {
  const name = relative(desktopRoot, path).replaceAll("\\", "/");
  const source = sourceWithoutComments(path);
  trustedRoutes += count(source, /\bregistry\s*\.\s*handle\s*\(/g);
  if (name.startsWith("src/backend/ipc/handlers/")) {
    guardedLegacyRoutes += count(source, /\bipcMain\s*\.\s*handle\s*\(/g);
  }

  if (
    name !== "src/backend/ipc/register-trusted-ipc-handler.ts" &&
    name !== "src/backend/ipc/trusted-ipc-main.ts" &&
    /import\s*{[^}]*\bipcMain\b[^}]*}\s*from\s*["']electron["']/.test(source)
  ) {
    const current = count(source, /\bipcMain\s*\.\s*handle\s*\(/g);
    directHandles += current;
    problems.push(`${name}: imports raw Electron ipcMain`);
  }
}

for (const path of listFiles(contractRoot).filter((path) => extname(path) === ".ts")) {
  const name = relative(desktopRoot, path).replaceAll("\\", "/");
  const source = sourceWithoutComments(path);
  if (/\bz\s*\.\s*any\s*\(/.test(source)) problems.push(`${name}: z.any() is forbidden`);
  if (/\brequest\s*:\s*z\s*\.\s*unknown\s*\(/.test(source)) {
    problems.push(`${name}: whole-request z.unknown() is forbidden`);
  }
}

console.log(JSON.stringify({ directHandles, trustedRoutes, guardedLegacyRoutes }, null, 2));
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
}
