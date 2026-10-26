import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function packageDirectories(root) {
  return ["packages", "apps"].flatMap((parent) => {
    const directory = path.join(root, parent);
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(path.join(directory, entry.name, "package.json")),
      )
      .map((entry) => parent + "/" + entry.name)
      .sort();
  });
}

export function npmInvocation() {
  const candidates = [
    process.env.NPM_CLI_JS,
    process.env.npm_execpath,
    process.platform === "win32" &&
      path.join(
        process.env.APPDATA ?? "",
        "npm/node_modules/npm/bin/npm-cli.js",
      ),
    path.join(
      path.dirname(process.execPath),
      "node_modules/npm/bin/npm-cli.js",
    ),
    path.resolve(
      path.dirname(process.execPath),
      "../lib/node_modules/npm/bin/npm-cli.js",
    ),
    "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
    "/usr/lib/node_modules/npm/bin/npm-cli.js",
  ].filter(Boolean);
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry)
    throw new Error(
      "Could not locate npm-cli.js. Set NPM_CLI_JS to its absolute path.",
    );
  return { command: process.execPath, prefix: [entry] };
}

export function runPackageCommands(root, args) {
  if (args.length === 0) throw new Error("An npm command is required.");
  const { command, prefix } = npmInvocation();
  for (const directory of packageDirectories(root)) {
    console.log(directory);
    const result = spawnSync(command, [...prefix, ...args], {
      cwd: path.join(root, directory),
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = runPackageCommands(
    path.resolve(import.meta.dirname, ".."),
    process.argv.slice(2),
  );
}
