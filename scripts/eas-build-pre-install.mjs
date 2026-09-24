/**
 * Runs on EAS before "Install dependencies".
 * Local engines require exact npm 11.19.0 (scripts/require-npm.mjs).
 */
import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("corepack", ["enable"]);
run("corepack", ["prepare", "npm@11.19.0", "--activate"]);

const version = spawnSync("npm", ["-v"], { encoding: "utf8", shell: process.platform === "win32" });
const npmVersion = (version.stdout || "").trim();
if (npmVersion !== "11.19.0") {
  console.error(`EAS pre-install: expected npm 11.19.0, got ${npmVersion || "unknown"}`);
  process.exit(1);
}
console.log(`EAS pre-install: npm ${npmVersion} ready`);