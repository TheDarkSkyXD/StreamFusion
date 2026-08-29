import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
const COMPETING_PACKAGE_FILES = new Set([
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);
const LOCKFILE_ROOTS = [".", path.join("apps", "desktop")];

export function findCompetingPackageFiles(fileNames) {
  return fileNames.filter((fileName) => COMPETING_PACKAGE_FILES.has(fileName));
}

export function isForbiddenDependencySource(specifier) {
  if (typeof specifier !== "string") return false;
  const value = specifier.trim();
  if (value.startsWith("npm:") || value.startsWith("$")) return false;
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

function findForbiddenOverrideSources(overrides, prefix = "overrides") {
  const violations = [];
  if (!overrides || typeof overrides !== "object") return violations;
  for (const [dependency, specifier] of Object.entries(overrides)) {
    const section = `${prefix}.${dependency}`;
    if (typeof specifier === "string") {
      if (isForbiddenDependencySource(specifier)) {
        violations.push({ dependency, section: prefix, specifier });
      }
    } else {
      violations.push(...findForbiddenOverrideSources(specifier, section));
    }
  }
  return violations;
}

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function validateRepository(rootDirectory) {
  const appsDirectory = path.join(rootDirectory, "apps");
  const manifestPaths = [path.join(rootDirectory, "package.json")];
  for (const entry of readdirSync(appsDirectory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      manifestPaths.push(path.join(appsDirectory, entry.name, "package.json"));
    }
  }

  const violations = [];
  for (const relativeRoot of LOCKFILE_ROOTS) {
    const policyDirectory = path.join(rootDirectory, relativeRoot);
    for (const file of findCompetingPackageFiles(
      readdirSync(policyDirectory),
    )) {
      violations.push({
        file: path.relative(rootDirectory, path.join(policyDirectory, file)),
        section: "repository",
        dependency: file,
        specifier: "competing package-manager file",
      });
    }
    const lockfilePath = path.join(policyDirectory, "package-lock.json");
    if (!existsSync(lockfilePath)) {
      violations.push({
        file: path.relative(rootDirectory, lockfilePath),
        section: "repository",
        dependency: "package-lock.json",
        specifier: "required npm lockfile is missing",
      });
    }
  }

  for (const manifestPath of manifestPaths) {
    const manifest = loadJson(manifestPath);
    for (const violation of [
      ...findForbiddenDependencySources(manifest),
      ...findForbiddenOverrideSources(manifest.overrides),
    ]) {
      violations.push({
        file: path.relative(rootDirectory, manifestPath),
        ...violation,
      });
    }
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
