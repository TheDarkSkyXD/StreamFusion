/**
 * EAS Build pre-install hook.
 * Ensure exact npm 11.19.0 before dependency install (scripts/require-npm.mjs).
 */
import { execSync } from "node:child_process";

function run(cmd) {
  console.log(`EAS pre-install: ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

try {
  run("npm install --global npm@11.19.0");
} catch (error) {
  console.error("EAS pre-install: global npm install failed, trying corepack");
  run("corepack enable");
  run("corepack prepare npm@11.19.0 --activate");
}

const npmVersion = execSync("npm -v", { encoding: "utf8" }).trim();
console.log(`EAS pre-install: npm ${npmVersion}`);
if (npmVersion !== "11.19.0") {
  console.error(`EAS pre-install: expected npm 11.19.0, got ${npmVersion}`);
  process.exit(1);
}