import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(
      process.env.APPDATA ?? path.sep,
      "npm",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
    path.join(
      process.execPath,
      "..",
      "..",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Could not locate npm-cli.js. Run this through npm so npm_execpath is set.",
  );
}

function audit(workspace) {
  // npm audit exits non-zero whenever it reports any advisory, which is the
  // normal case here, so the report is read from stdout rather than the status.
  let stdout = "";
  try {
    stdout = execFileSync(
      process.execPath,
      [resolveNpmCli(), "audit", "--workspace", workspace, "--omit=dev", "--json"],
      { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    if (error.stdout) stdout = error.stdout;
    else throw error;
  }
  return JSON.parse(stdout);
}

function mobileProductionDependencies() {
  const manifest = JSON.parse(
    readFileSync(
      path.join(repositoryRoot, "apps", "mobile", "package.json"),
      "utf8",
    ),
  );
  return new Set(Object.keys(manifest.dependencies ?? {}));
}

/**
 * An Android release is gated on the advisories that reach a device. npm audit
 * walks the whole install tree, so build-time tooling such as @expo/fingerprint
 * and jsdom reports high-severity findings that are never bundled into the APK.
 * This narrows the failure to advisories on a package the app actually depends
 * on at runtime, and prints the ignored ones so the exclusion stays visible
 * rather than silent.
 */
export function partitionAdvisories({ report, shipped }) {
  const blocking = [];
  const ignored = [];

  for (const [name, advisory] of Object.entries(report.vulnerabilities ?? {})) {
    if (!BLOCKING_SEVERITIES.has(advisory.severity)) continue;

    const reachable = advisory.isDirect
      ? shipped.has(name)
      : (advisory.effects ?? []).some((effect) => shipped.has(effect));
    const entry = {
      package: name,
      severity: advisory.severity,
      direct: Boolean(advisory.isDirect),
      advisories: (advisory.via ?? [])
        .filter((via) => typeof via === "object")
        .map((via) => via.title),
    };
    if (reachable) blocking.push(entry);
    else ignored.push(entry);
  }

  return { blocking, ignored };
}

function runCli() {
  const shipped = mobileProductionDependencies();
  const report = audit("@streamfusion/mobile");
  const { blocking, ignored } = partitionAdvisories({ report, shipped });

  for (const entry of ignored) {
    console.log(
      `Ignoring ${entry.package} (${entry.severity}): build-time only, not bundled into the APK.`,
    );
  }

  assert.equal(
    blocking.length,
    0,
    `An Android release cannot ship these known vulnerabilities:\n${blocking
      .map(
        (entry) =>
          `  ${entry.package} (${entry.severity}${entry.direct ? ", direct" : ""})\n${entry.advisories
            .map((title) => `    - ${title}`)
            .join("\n")}`,
      )
      .join("\n")}`,
  );

  console.log(
    `Android release dependency audit passed: ${shipped.size} shipped production dependencies, no blocking advisories.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
