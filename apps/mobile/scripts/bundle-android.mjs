import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
mkdirSync(path.join(mobileRoot, "dist"), { recursive: true });
const child = spawn(process.execPath, [
  require.resolve("@react-native-community/cli/build/bin.js"), "bundle",
  "--platform", "android", "--dev", "false", "--entry-file", "index.js",
  "--bundle-output", "dist/index.android.bundle", "--assets-dest", "dist",
  "--sourcemap-output", "dist/index.android.bundle.map",
], { cwd: mobileRoot, stdio: "inherit", windowsHide: true });
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("exit", (code) => {
  if (code === 0) writeFileSync(path.join(mobileRoot, "dist/metadata.json"), JSON.stringify({ fileMetadata: { android: { bundle: "index.android.bundle" } } }));
  process.exitCode = code ?? 1;
});
