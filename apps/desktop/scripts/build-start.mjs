import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { assembleStartRenderer } from "./assemble-start-renderer.mjs";

const desktop = resolve(import.meta.dirname, "..");
const require = createRequire(resolve(desktop, "package.json"));
const appDir = resolve(desktop, ".cache/start/app");

for (const [name, cli, args] of [
  ["electron-vite", "bin/electron-vite.js", ["build", "--config", "start.electron.config.ts"]],
  ["electron-vite", "bin/electron-vite.js", ["build", "--config", "slot.preload.config.ts"]],
  ["vite", "bin/vite.js", ["build", "--config", "start.vite.config.mts"]],
]) {
  const executable = resolve(dirname(require.resolve(`${name}/package.json`)), cli);
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: desktop,
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await assembleStartRenderer({
  clientDir: resolve(desktop, ".cache/start/raw/client"),
  rendererDir: resolve(appDir, "out/renderer"),
  productionHtmlPath: resolve(desktop, "index.html"),
});
mkdirSync(appDir, { recursive: true });
cpSync(resolve(desktop, "assets"), resolve(appDir, "assets"), { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(desktop, "package.json"), "utf8"));
delete manifest.build;
delete manifest.scripts;
delete manifest.devDependencies;
writeFileSync(resolve(appDir, "package.json"), JSON.stringify(manifest, null, 2));
console.log(`Start candidate ready at ${appDir}`);
