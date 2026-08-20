import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertPnpmUserAgent, isPnpmUserAgent } from "./require-pnpm.mjs";
import {
  findCompetingLockfiles,
  findForbiddenDependencySources,
  isForbiddenDependencySource,
  validateRepository,
} from "./validate-dependency-sources.mjs";

test("the install guard accepts pnpm and rejects other package managers", () => {
  assert.equal(
    isPnpmUserAgent("pnpm/11.17.0 npm/? node/v24.14.0 win32 x64"),
    true,
  );
  assert.equal(isPnpmUserAgent("npm/11.8.0 node/v24.14.0 win32 x64"), false);
  assert.equal(
    isPnpmUserAgent("yarn/4.9.2 npm/? node/v24.14.0 win32 x64"),
    false,
  );
  assert.equal(isPnpmUserAgent(undefined), false);

  assert.doesNotThrow(() => assertPnpmUserAgent("pnpm/11.17.0 npm/?"));
  assert.throws(
    () => assertPnpmUserAgent("npm/11.8.0 node/v24.14.0"),
    /pnpm install/,
  );
});

test("dependency policy rejects Git, URL, tarball, and local file sources", () => {
  for (const specifier of [
    "git+ssh://git@github.com/org/repo.git",
    "git+https://github.com/org/repo.git#commit",
    "github:org/repo",
    "https://example.com/archive.tgz",
    "file:../package",
    "link:../package",
    "../package",
    "C:\\packages\\local-package",
    "git@github.com:org/repo.git",
  ]) {
    assert.equal(isForbiddenDependencySource(specifier), true, specifier);
  }
});

test("dependency policy permits registry versions, aliases, and workspace references", () => {
  for (const specifier of [
    "^1.2.3",
    "1.2.3",
    "latest",
    "npm:@npmcli/fs@^3.1.0",
    "workspace:^",
    "catalog:",
  ]) {
    assert.equal(isForbiddenDependencySource(specifier), false, specifier);
  }
});

test("dependency policy reports the manifest section and dependency name", () => {
  const violations = findForbiddenDependencySources({
    dependencies: {
      safe: "^1.0.0",
      unsafe: "github:org/repo",
    },
    devDependencies: {
      local: "file:../local",
    },
    optionalDependencies: {
      archive: "https://example.com/archive.tgz",
    },
    peerDependencies: {
      peer: "^2.0.0",
    },
  });

  assert.deepEqual(violations, [
    {
      dependency: "unsafe",
      section: "dependencies",
      specifier: "github:org/repo",
    },
    {
      dependency: "local",
      section: "devDependencies",
      specifier: "file:../local",
    },
    {
      dependency: "archive",
      section: "optionalDependencies",
      specifier: "https://example.com/archive.tgz",
    },
  ]);
});

test("dependency policy rejects competing package-manager lockfiles", () => {
  assert.deepEqual(
    findCompetingLockfiles([
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
      "bun.lockb",
      "README.md",
    ]),
    ["package-lock.json", "yarn.lock", "bun.lockb"],
  );
});

test("dependency policy validates the desktop workspace and lockfile boundary", () => {
  const rootDirectory = mkdtempSync(
    path.join(os.tmpdir(), "streamfusion-package-policy-"),
  );
  try {
    const desktopDirectory = path.join(rootDirectory, "apps", "desktop");
    mkdirSync(desktopDirectory, { recursive: true });
    writeFileSync(path.join(rootDirectory, "package.json"), "{}\n");
    writeFileSync(path.join(rootDirectory, "pnpm-workspace.yaml"), "{}\n");
    writeFileSync(path.join(desktopDirectory, "package.json"), "{}\n");
    writeFileSync(
      path.join(desktopDirectory, "pnpm-workspace.yaml"),
      "overrides:\n  unsafe: github:org/repo\n",
    );
    writeFileSync(path.join(desktopDirectory, "package-lock.json"), "{}\n");

    assert.deepEqual(validateRepository(rootDirectory), [
      {
        file: path.join("apps", "desktop", "package-lock.json"),
        section: "repository",
        dependency: "package-lock.json",
        specifier: "competing lockfile",
      },
      {
        file: path.join("apps", "desktop", "pnpm-workspace.yaml"),
        section: "overrides",
        dependency: "unsafe",
        specifier: "github:org/repo",
      },
    ]);
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});
