const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "../../..");
const result = spawnSync(process.execPath, [
  require.resolve("patch-package/index.js"),
  "--patch-dir", "apps/mobile/patches",
  "--error-on-fail",
], { cwd: repositoryRoot, stdio: "inherit" });

if (result.error) throw result.error;
process.exit(result.status ?? 1);
