const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { prepareWindowsNinja } = require("./prepare-windows-ninja.cjs");

const repositoryRoot = path.resolve(__dirname, "../../..");
const mobileRoot = path.resolve(__dirname, "..");
const result = spawnSync(
  process.execPath,
  [
    require.resolve("patch-package/index.js"),
    "--patch-dir",
    "patches",
    "--error-on-fail",
  ],
  { cwd: mobileRoot, stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
prepareWindowsNinja(repositoryRoot).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
