import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { load as loadYaml } from "js-yaml";

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

const FORBIDDEN_PROTOCOL =
  /^(?:git(?:\+[^:]+)?:|github:|gitlab:|bitbucket:|https?:|ssh:|file:|link:)/i;
const SCP_STYLE_GIT = /^[^\s@]+@[^\s:]+:[^\s]+$/;
const LOCAL_PATH = /^(?:\.{1,2}[\\/]|[\\/]|~[\\/]|[a-z]:[\\/])/i;
const LOCAL_TARBALL = /\.tgz(?:$|[?#])/i;
const COMPETING_LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

export function findCompetingLockfiles(fileNames) {
  return fileNames.filter((fileName) => COMPETING_LOCKFILES.has(fileName));
}

export function isForbiddenDependencySource(specifier) {
  if (typeof specifier !== "string") return false;

  const value = specifier.trim();
  if (
    value.startsWith("npm:") ||
    value.startsWith("workspace:") ||
    value.startsWith("catalog:")
  ) {
    return false;
  }

  return (
    FORBIDDEN_PROTOCOL.test(value) ||
    SCP_STYLE_GIT.test(value) ||
    LOCAL_PATH.test(value) ||
    LOCAL_TARBALL.test(value)
  );
}

export function findForbiddenDependencySources(manifest) {
  const violations = [];

  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = manifest[section];
    if (!dependencies || typeof dependencies !== "object") continue;

    for (const [dependency, specifier] of Object.entries(dependencies)) {
      if (isForbiddenDependencySource(specifier)) {
        violations.push({ dependency, section, specifier });
      }
    }
  }

  return violations;
}

function findForbiddenWorkspaceSources(workspace) {
  const violations = [];
  const collections = [
    ["overrides", workspace.overrides],
    ["catalog", workspace.catalog],
    ...Object.entries(workspace.catalogs ?? {}).map(([name, catalog]) => [
      `catalogs.${name}`,
      catalog,
    ]),
  ];

  for (const [section, dependencies] of collections) {
    if (!dependencies || typeof dependencies !== "object") continue;

    for (const [dependency, specifier] of Object.entries(dependencies)) {
      if (isForbiddenDependencySource(specifier)) {
        violations.push({ dependency, section, specifier });
      }
    }
  }

  return violations;
}

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function validateRepository(rootDirectory) {
  const manifestPaths = [path.join(rootDirectory, "package.json")];
  const appsDirectory = path.join(rootDirectory, "apps");

  for (const entry of readdirSync(appsDirectory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      manifestPaths.push(path.join(appsDirectory, entry.name, "package.json"));
    }
  }

  const violations = [];
  for (const file of findCompetingLockfiles(readdirSync(rootDirectory))) {
    violations.push({
      file,
      section: "repository",
      dependency: file,
      specifier: "competing lockfile",
    });
  }

  for (const manifestPath of manifestPaths) {
    const manifest = loadJson(manifestPath);
    for (const violation of findForbiddenDependencySources(manifest)) {
      violations.push({
        file: path.relative(rootDirectory, manifestPath),
        ...violation,
      });
    }
  }

  const workspacePath = path.join(rootDirectory, "pnpm-workspace.yaml");
  const workspace = loadYaml(readFileSync(workspacePath, "utf8"));
  for (const violation of findForbiddenWorkspaceSources(workspace)) {
    violations.push({ file: "pnpm-workspace.yaml", ...violation });
  }

  return violations;
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const rootDirectory = path.resolve(import.meta.dirname, "..");
  const violations = validateRepository(rootDirectory);

  if (violations.length > 0) {
    for (const { file, section, dependency, specifier } of violations) {
      console.error(
        `${file}: ${section}.${dependency} uses forbidden source ${specifier}`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log("Dependency source policy passed.");
  }
}
