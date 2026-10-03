import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findBlockedRuntimeDependencies } from "./blocked-dependencies.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

function npmInvocation() {
  // npm's install location differs per platform and per runner image, and a
  // GitHub runner does not export npm_execpath. NPM_CLI_JS is supplied by the
  // release workflow, which resolves it with the shell, and the remaining
  // candidates cover a normal local checkout.
  const candidates = [
    process.env.NPM_CLI_JS,
    process.env.npm_execpath,
    path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
    process.platform === "win32"
      ? path.join(
          process.env.APPDATA ?? path.sep,
          "npm",
          "node_modules",
          "npm",
          "bin",
          "npm-cli.js",
        )
      : "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
    process.platform === "win32"
      ? null
      : "/usr/lib/node_modules/npm/bin/npm-cli.js",
  ].filter(Boolean);

  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry) {
    throw new Error(
      "Could not locate npm-cli.js. Set NPM_CLI_JS to its absolute path.",
    );
  }
  return { command: process.execPath, prefix: [entry] };
}

function audit(workspace) {
  // npm audit exits non-zero whenever it reports any advisory, which is the
  // normal case here, so the report is read from stdout rather than the status.
  const { command, prefix } = npmInvocation();
  let stdout = "";
  try {
    stdout = execFileSync(
      command,
      [...prefix, "audit", "--workspace", workspace, "--omit=dev", "--json"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    if (error.stdout) stdout = error.stdout;
    else throw error;
  }
  const report = JSON.parse(stdout);
  assert.equal(report.auditReportVersion, 2, "Unsupported npm audit report.");
  return report;
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

export function bundledInstallNodes(sourceMap) {
  assert.ok(
    !sourceMap.sourceRoot,
    "Android source map uses an unsupported source root.",
  );
  assert.equal(
    sourceMap.version,
    3,
    "Expected a version 3 Android source map.",
  );
  assert.ok(
    Array.isArray(sourceMap.sources),
    "Android source map has no sources.",
  );
  assert.ok(sourceMap.sources.length > 0, "Android source map is empty.");
  const nodes = new Set();
  const root = repositoryRoot.replaceAll("\\", "/");
  for (const source of sourceMap.sources) {
    assert.equal(typeof source, "string", "Invalid Android source path.");
    let relative = source.replaceAll("\\", "/");
    if (relative.startsWith(`${root}/`))
      relative = relative.slice(root.length + 1);
    relative = relative.replace(/^\//u, "");
    const node = relative.match(
      /^(.*(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+)\//u,
    )?.[1];
    if (!node) continue;
    assert.ok(
      !path.isAbsolute(node) && !node.split("/").includes(".."),
      "Android source path is not repository-relative.",
    );
    nodes.add(node);
  }
  assert.ok(
    nodes.size > 0,
    "Android source map contains no dependency evidence.",
  );
  return nodes;
}

function readBundledInstallNodes(directory) {
  assert.ok(
    directory,
    "Pass the fresh Android export directory to the release audit.",
  );
  const root = path.resolve(directory);
  const metadata = JSON.parse(
    readFileSync(path.join(root, "metadata.json"), "utf8"),
  );
  const bundle = metadata.fileMetadata?.android?.bundle;
  assert.equal(
    typeof bundle,
    "string",
    "Export metadata has no Android bundle.",
  );
  const bundlePath = path.resolve(root, bundle);
  const relative = path.relative(root, bundlePath);
  assert.ok(
    !path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..",
    "Android bundle is outside the export directory.",
  );
  assert.ok(existsSync(bundlePath), "Android export bundle is missing.");
  return bundledInstallNodes(
    JSON.parse(readFileSync(`${bundlePath}.map`, "utf8")),
  );
}

export function partitionAdvisories({ report, shipped, bundled }) {
  assert.ok(!report.error, "npm audit could not inspect the dependency tree.");
  assert.ok(
    report.vulnerabilities &&
      typeof report.vulnerabilities === "object" &&
      !Array.isArray(report.vulnerabilities),
    "npm audit returned no vulnerability report.",
  );
  assert.ok(
    shipped instanceof Set && bundled instanceof Set,
    "Release dependency evidence is missing.",
  );
  const blocking = [];
  const ignored = [];

  for (const [name, advisory] of Object.entries(report.vulnerabilities)) {
    assert.ok(
      Array.isArray(advisory.via) && advisory.via.length > 0,
      `npm audit has no advisory details for ${name}.`,
    );
    for (const via of advisory.via) {
      if (typeof via === "string") {
        assert.ok(
          report.vulnerabilities[via],
          `npm audit is missing advisory package ${via}.`,
        );
      } else {
        assert.ok(
          via &&
            ["info", "low", "moderate", "high", "critical"].includes(
              via.severity,
            ),
          `npm audit has an invalid advisory for ${name}.`,
        );
      }
    }
    const concrete = advisory.via.filter(
      (via) => typeof via === "object" && BLOCKING_SEVERITIES.has(via.severity),
    );
    if (concrete.length === 0) continue;
    for (const via of concrete) {
      assert.equal(
        via.name,
        name,
        `npm audit advisory package does not match ${name}.`,
      );
      assert.ok(
        typeof via.title === "string" && via.title,
        `npm audit advisory has no title for ${name}.`,
      );
    }
    assert.ok(
      Array.isArray(advisory.nodes) &&
        advisory.nodes.length > 0 &&
        advisory.nodes.every(
          (node) =>
            typeof node === "string" &&
            /(?:^|\/)node_modules\//u.test(node) &&
            !path.isAbsolute(node) &&
            !node.split("/").includes(".."),
        ),
      `npm audit has no affected install nodes for ${name}.`,
    );

    const reachable =
      shipped.has(name) || advisory.nodes.some((node) => bundled.has(node));
    const entry = {
      package: name,
      severity: concrete.some((via) => via.severity === "critical")
        ? "critical"
        : "high",
      direct: Boolean(advisory.isDirect),
      advisories: concrete.map((via) => via.title),
    };
    if (reachable) blocking.push(entry);
    else ignored.push(entry);
  }

  assert.ok(
    blocking.length + ignored.length > 0 ||
      !Object.values(report.vulnerabilities).some((entry) =>
        BLOCKING_SEVERITIES.has(entry.severity),
      ),
    "npm audit reported high severity dependencies without concrete advisories.",
  );

  return { blocking, ignored };
}

function runCli() {
  const shipped = mobileProductionDependencies();
  const bundled = readBundledInstallNodes(process.argv[2]);
  assert.deepEqual(
    findBlockedRuntimeDependencies({ direct: shipped, bundled }),
    [],
    "Blocked dependencies cannot be shipped in an Android release.",
  );
  const report = audit("@streamfusion/mobile");
  const { blocking, ignored } = partitionAdvisories({
    report,
    shipped,
    bundled,
  });

  for (const entry of ignored) {
    console.log(
      `Excluded ${entry.package} (${entry.severity}): absent from direct native dependencies and the Android JavaScript export.`,
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
    `Android release dependency audit passed: ${shipped.size} direct production dependencies and ${bundled.size} bundled install nodes, no blocking advisories.`,
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
