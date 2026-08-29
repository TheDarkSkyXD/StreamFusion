import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findCompetingPackageFiles,
  findForbiddenDependencySources,
  isForbiddenDependencySource,
  validateRepository,
} from "./validate-dependency-sources.mjs";
import {
  assertRequiredNpm,
  npmVersionFromUserAgent,
  REQUIRED_NPM_VERSION,
} from "./require-npm.mjs";

test("the install guard accepts only the pinned npm version", () => {
  assert.equal(
    npmVersionFromUserAgent("npm/11.19.0 node/v24.14.0 win32 x64"),
    REQUIRED_NPM_VERSION,
  );
  assert.equal(
    npmVersionFromUserAgent("pnpm/11.17.0 npm/? node/v24.14.0 win32 x64"),
    null,
  );
  assert.equal(npmVersionFromUserAgent(undefined), null);
  assert.doesNotThrow(() =>
    assertRequiredNpm("npm/11.19.0 node/v24.14.0 win32 x64"),
  );
  for (const userAgent of [
    "npm/11.8.0 node/v24.14.0 win32 x64",
    "pnpm/11.17.0 npm/? node/v24.14.0 win32 x64",
    undefined,
  ]) {
    assert.throws(() => assertRequiredNpm(userAgent), /npm 11\.19\.0/);
  }
});

test("root start supports npm 11 while installs remain pinned", () => {
  const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
  const desktopPackage = JSON.parse(
    readFileSync("apps/desktop/package.json", "utf8"),
  );

  for (const packageManifest of [rootPackage, desktopPackage]) {
    assert.equal(packageManifest.engines.npm, ">=11.8.0 <12");
    assert.equal(packageManifest.devEngines.packageManager.version, ">=11.8.0 <12");
    assert.equal(packageManifest.devEngines.packageManager.onFail, "error");
    assert.equal(packageManifest.packageManager, `npm@${REQUIRED_NPM_VERSION}`);
    assert.match(packageManifest.scripts.preinstall, /require-npm\.mjs/);
  }

  assert.equal(
    rootPackage.scripts.start,
    "npm --prefix apps/desktop run start:checked",
  );
  assert.match(
    desktopPackage.scripts["start:checked"],
    /node scripts\/start-picker\.js/,
  );

  for (const npmConfigPath of [".npmrc", "apps/desktop/.npmrc"]) {
    assert.match(readFileSync(npmConfigPath, "utf8"), /^loglevel=error$/m);
  }
});

test("dependency policy rejects Git, URL, tarball, and local sources", () => {
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

test("dependency policy permits registry versions, aliases, and override references", () => {
  for (const specifier of [
    "^1.2.3",
    "1.2.3",
    "latest",
    "npm:@npmcli/fs@^3.1.0",
    "$directDependency",
  ]) {
    assert.equal(isForbiddenDependencySource(specifier), false, specifier);
  }
});

test("dependency policy reports manifest sections and dependency names", () => {
  const violations = findForbiddenDependencySources({
    dependencies: { safe: "^1.0.0", unsafe: "github:org/repo" },
    devDependencies: { local: "file:../local" },
    optionalDependencies: { archive: "https://example.com/archive.tgz" },
    peerDependencies: { peer: "^2.0.0" },
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

test("dependency policy rejects other package-manager files", () => {
  assert.deepEqual(
    findCompetingPackageFiles([
      "package-lock.json",
      "npm-shrinkwrap.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "yarn.lock",
      "bun.lockb",
      "README.md",
    ]),
    [
      "npm-shrinkwrap.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "yarn.lock",
      "bun.lockb",
    ],
  );
});

test("repository policy requires root and desktop npm lockfiles", () => {
  const rootDirectory = mkdtempSync(
    path.join(os.tmpdir(), "streamfusion-package-policy-"),
  );
  try {
    const desktopDirectory = path.join(rootDirectory, "apps", "desktop");
    const workerDirectory = path.join(rootDirectory, "apps", "worker");
    mkdirSync(desktopDirectory, { recursive: true });
    mkdirSync(workerDirectory, { recursive: true });
    writeFileSync(path.join(rootDirectory, "package.json"), "{}\n");
    writeFileSync(path.join(desktopDirectory, "package.json"), "{}\n");
    writeFileSync(path.join(workerDirectory, "package.json"), "{}\n");
    writeFileSync(path.join(rootDirectory, "package-lock.json"), "{}\n");
    writeFileSync(path.join(desktopDirectory, "pnpm-lock.yaml"), "{}\n");

    assert.deepEqual(validateRepository(rootDirectory), [
      {
        file: path.join("apps", "desktop", "pnpm-lock.yaml"),
        section: "repository",
        dependency: "pnpm-lock.yaml",
        specifier: "competing package-manager file",
      },
      {
        file: path.join("apps", "desktop", "package-lock.json"),
        section: "repository",
        dependency: "package-lock.json",
        specifier: "required npm lockfile is missing",
      },
    ]);
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});

test("repository policy checks nested npm overrides", () => {
  const rootDirectory = mkdtempSync(
    path.join(os.tmpdir(), "streamfusion-package-policy-"),
  );
  try {
    const desktopDirectory = path.join(rootDirectory, "apps", "desktop");
    const workerDirectory = path.join(rootDirectory, "apps", "worker");
    mkdirSync(desktopDirectory, { recursive: true });
    mkdirSync(workerDirectory, { recursive: true });
    writeFileSync(
      path.join(rootDirectory, "package.json"),
      '{"overrides":{"parent":{"unsafe":"github:org/repo"}}}\n',
    );
    writeFileSync(path.join(desktopDirectory, "package.json"), "{}\n");
    writeFileSync(path.join(workerDirectory, "package.json"), "{}\n");
    writeFileSync(path.join(rootDirectory, "package-lock.json"), "{}\n");
    writeFileSync(path.join(desktopDirectory, "package-lock.json"), "{}\n");

    assert.deepEqual(validateRepository(rootDirectory), [
      {
        file: "package.json",
        dependency: "unsafe",
        section: "overrides.parent",
        specifier: "github:org/repo",
      },
    ]);
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});

test("the two dependency roots share npm policy and override baselines", () => {
  assert.equal(
    readFileSync(".npmrc", "utf8"),
    readFileSync("apps/desktop/.npmrc", "utf8"),
  );
  const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
  const desktopPackage = JSON.parse(
    readFileSync("apps/desktop/package.json", "utf8"),
  );
  assert.deepEqual(desktopPackage.overrides, rootPackage.overrides);
});
