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
const WORKSPACE_DIRECTORIES = ["apps", "packages"];

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
  const manifestPaths = [path.join(rootDirectory, "package.json")];
  const workspaceDirectories = [];
  for (const relativeDirectory of WORKSPACE_DIRECTORIES) {
    const workspaceRoot = path.join(rootDirectory, relativeDirectory);
    if (!existsSync(workspaceRoot)) continue;
    for (const entry of readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const workspaceDirectory = path.join(workspaceRoot, entry.name);
      const manifestPath = path.join(workspaceDirectory, "package.json");
      if (existsSync(manifestPath)) {
        workspaceDirectories.push(workspaceDirectory);
        manifestPaths.push(manifestPath);
      }
    }
  }

  const violations = [];
  for (const file of findCompetingPackageFiles(readdirSync(rootDirectory))) {
    violations.push({
      file,
      section: "repository",
      dependency: file,
      specifier: "competing package-manager file",
    });
  }
  const rootLockfilePath = path.join(rootDirectory, "package-lock.json");
  if (!existsSync(rootLockfilePath)) {
    violations.push({
      file: "package-lock.json",
      section: "repository",
      dependency: "package-lock.json",
      specifier: "required npm lockfile is missing",
    });
  }

  for (const workspaceDirectory of workspaceDirectories) {
    const nestedLockfilePath = path.join(workspaceDirectory, "package-lock.json");
    if (existsSync(nestedLockfilePath)) {
      violations.push({
        file: path.relative(rootDirectory, nestedLockfilePath),
        section: "repository",
        dependency: "package-lock.json",
        specifier: "nested npm lockfile is not allowed",
      });
    }
    for (const file of findCompetingPackageFiles(
      readdirSync(workspaceDirectory),
    )) {
      violations.push({
        file: path.relative(rootDirectory, path.join(workspaceDirectory, file)),
        section: "repository",
        dependency: file,
        specifier: "competing package-manager file",
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
