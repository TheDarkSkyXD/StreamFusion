import assert from "node:assert/strict";
import {
  existsSync,
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

test("the root workspace owns npm policy and application startup", () => {
  const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
  const desktopPackage = JSON.parse(
    readFileSync("apps/desktop/package.json", "utf8"),
  );
  const mobilePackage = JSON.parse(
    readFileSync("apps/mobile/package.json", "utf8"),
  );
  const relayPackage = JSON.parse(
    readFileSync("apps/integration-relay/package.json", "utf8"),
  );

  assert.equal(rootPackage.engines.npm, ">=11.8.0 <12");
  assert.equal(rootPackage.devEngines.packageManager.version, ">=11.8.0 <12");
  assert.equal(rootPackage.devEngines.packageManager.onFail, "error");
  assert.equal(rootPackage.packageManager, `npm@${REQUIRED_NPM_VERSION}`);
  assert.match(rootPackage.scripts.preinstall, /require-npm\.mjs/);
  assert.deepEqual(rootPackage.workspaces, ["apps/*", "packages/*"]);

  assert.equal(rootPackage.scripts.start, "node scripts/start-picker.mjs");
  assert.equal(rootPackage.scripts.prepare, "npm run install:hooks");
  assert.equal(
    rootPackage.scripts["install:hooks"],
    "git config --local core.hooksPath .githooks",
  );
  assert.match(
    rootPackage.scripts["install:dependencies"],
    /npm run install:hooks/,
  );
  assert.equal(
    rootPackage.scripts["e2e:preview"],
    "node .agents/skills/verify-streamfusion/scripts/control.mjs session --mode preview --",
  );
  assert.equal(
    rootPackage.scripts["test:e2e"],
    "node .agents/skills/verify-streamfusion/scripts/control.mjs smoke --mode preview --fresh",
  );
  assert.equal(
    readFileSync(".githooks/pre-commit", "utf8"),
    [
      "#!/bin/sh",
      "",
      "if ! git diff --quiet --ignore-submodules --; then",
      '  echo "pre-commit: stage or stash tracked changes before running E2E" >&2',
      "  exit 1",
      "fi",
      "",
      'if test -n "$(git ls-files --others --exclude-standard)"; then',
      '  echo "pre-commit: stage or remove untracked files before running E2E" >&2',
      "  exit 1",
      "fi",
      "",
      "exec npm run test:e2e",
      "",
    ].join("\n"),
  );
  assert.equal(
    rootPackage.scripts.desktop,
    "npm run --workspace streamfusion dev:electron --",
  );
  assert.equal(
    rootPackage.scripts.browser,
    "npm run --workspace streamfusion dev --",
  );
  assert.equal(
    rootPackage.scripts.mobile,
    "npm run --workspace @streamfusion/mobile android --",
  );
  assert.equal(
    rootPackage.scripts["mobile:native"],
    "npm run --workspace @streamfusion/mobile android:native --",
  );
  assert.equal(mobilePackage.scripts.android, "node scripts/start-expo-go.mjs");
  assert.equal(
    mobilePackage.scripts["android:native"],
    "node scripts/run-android.mjs",
  );
  assert.equal(
    rootPackage.scripts.relay,
    "npm run --workspace @streamfusion/integration-relay dev",
  );
  assert.equal(
    rootPackage.scripts["build:relay"],
    "npm run --workspace @streamfusion/integration-relay build",
  );
  assert.equal(relayPackage.scripts.dev, "wrangler dev --env development");
  assert.equal(
    rootPackage.scripts["verify:evidence"],
    "node scripts/verify-evidence.mjs --resume",
  );
  assert.equal(
    rootPackage.scripts["test:evidence"],
    "node --test scripts/verify-evidence.test.mjs scripts/verify-core-extraction-complete.test.mjs",
  );
  assert.match(rootPackage.scripts.test, /npm run test:evidence/);
  assert.match(rootPackage.scripts["test:all"], /npm run test:evidence/);

  assert.match(readFileSync(".npmrc", "utf8"), /^loglevel=error$/m);
  assert.equal(existsSync("apps/desktop/.npmrc"), false);
  assert.equal(desktopPackage.allowScripts, undefined);
  assert.equal(desktopPackage.overrides, undefined);
  assert.ok(rootPackage.allowScripts["better-sqlite3@13.0.3"]);
  assert.ok(rootPackage.overrides["@napi-rs/wasm-runtime"]);
  assert.match(
    rootPackage.scripts["rebuild:dependencies"],
    /^npm rebuild better-sqlite3 electron-winstaller esbuild ffmpeg-static fsevents unrs-resolver workerd /,
  );
  assert.doesNotMatch(
    rootPackage.scripts["rebuild:dependencies"],
    /^npm rebuild --ignore-scripts=false/,
  );
  assert.match(
    rootPackage.scripts.lint,
    /npm run --workspace @streamfusion\/core lint/,
  );
  assert.match(rootPackage.scripts.lint, /npm run lint:core-imports/);
  assert.match(
    rootPackage.scripts.typecheck,
    /^npm run --workspace @streamfusion\/core typecheck/,
  );
  assert.match(
    rootPackage.scripts.typecheck,
    /npm run --workspace @streamfusion\/mobile typecheck/,
  );
  for (const gate of ["lint", "test", "test:all", "typecheck"]) {
    const relayGate = gate === "test:all" ? "test" : gate;
    assert.match(
      rootPackage.scripts[gate],
      new RegExp(
        `npm run --workspace @streamfusion/integration-relay ${relayGate}`,
      ),
      `${gate} must include the integration relay`,
    );
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

test("repository policy requires one root lockfile and rejects nested lockfiles", () => {
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
    writeFileSync(path.join(desktopDirectory, "package-lock.json"), "{}\n");
    writeFileSync(path.join(desktopDirectory, "pnpm-lock.yaml"), "{}\n");

    assert.deepEqual(validateRepository(rootDirectory), [
      {
        file: "package-lock.json",
        section: "repository",
        dependency: "package-lock.json",
        specifier: "required npm lockfile is missing",
      },
      {
        file: path.join("apps", "desktop", "package-lock.json"),
        section: "repository",
        dependency: "package-lock.json",
        specifier: "nested npm lockfile is not allowed",
      },
      {
        file: path.join("apps", "desktop", "pnpm-lock.yaml"),
        section: "repository",
        dependency: "pnpm-lock.yaml",
        specifier: "competing package-manager file",
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

test("the root owns the dependency policy and override baseline", () => {
  const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
  const rootLockfile = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const desktopPackage = JSON.parse(
    readFileSync("apps/desktop/package.json", "utf8"),
  );
  assert.equal(existsSync("apps/desktop/.npmrc"), false);
  assert.equal(desktopPackage.overrides, undefined);
  assert.equal(desktopPackage.allowScripts, undefined);
  assert.ok(Object.keys(rootPackage.overrides).length > 0);
  assert.equal(rootPackage.devDependencies.ws, "8.21.3");
  assert.deepEqual(rootPackage.overrides["@tanstack/router-core@1.171.26"], {
    seroval: "1.6.2",
    "seroval-plugins": "1.6.2",
  });
  assert.equal(rootPackage.overrides["react-native-reanimated"], "4.5.1");
  assert.equal(rootPackage.overrides["react-native-worklets"], "0.10.1");
  assert.ok(Object.keys(rootPackage.allowScripts).length > 0);
  assert.deepEqual(
    rootLockfile.packages[""].workspaces,
    rootPackage.workspaces,
  );
  assert.equal(rootLockfile.packages["apps/desktop"].name, "streamfusion");
  assert.equal(
    rootLockfile.packages["apps/worker"].name,
    "streamfusion-worker",
  );
  assert.equal(
    rootLockfile.packages["apps/mobile"].name,
    "@streamfusion/mobile",
  );
  assert.equal(
    rootLockfile.packages["apps/integration-relay"].name,
    "@streamfusion/integration-relay",
  );
  assert.equal(
    rootLockfile.packages["packages/core"].name,
    "@streamfusion/core",
  );
  assert.deepEqual(rootLockfile.packages["node_modules/streamfusion"], {
    resolved: "apps/desktop",
    link: true,
  });
  assert.deepEqual(rootLockfile.packages["node_modules/@streamfusion/core"], {
    resolved: "packages/core",
    link: true,
  });
  assert.deepEqual(rootLockfile.packages["node_modules/@streamfusion/mobile"], {
    resolved: "apps/mobile",
    link: true,
  });
  assert.deepEqual(
    rootLockfile.packages["node_modules/@streamfusion/integration-relay"],
    {
      resolved: "apps/integration-relay",
      link: true,
    },
  );
  assert.equal(rootLockfile.packages["node_modules/ws"].version, "8.21.3");
  assert.equal(
    rootLockfile.packages["node_modules/miniflare/node_modules/ws"].version,
    "8.21.0",
  );
  assert.equal(
    rootLockfile.packages[
      "node_modules/@tanstack/router-core/node_modules/seroval"
    ].version,
    "1.6.2",
  );
  assert.equal(
    rootLockfile.packages[
      "node_modules/@tanstack/router-core/node_modules/seroval-plugins"
    ].version,
    "1.6.2",
  );
});
