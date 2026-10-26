import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

test("linked Core enforces npm through devEngines without an install hook", () => {
  const core = readJson(path.join(root, "packages/core/package.json"));
  assert.equal(core.scripts.preinstall, undefined);
  assert.deepEqual(core.devEngines.packageManager, {
    name: "npm",
    version: "11.19.0",
    onFail: "error",
  });
  const tooling = readJson(path.join(root, "packages/tooling/package.json"));
  assert.deepEqual(tooling.devEngines, core.devEngines);
});

test("the repository root keeps dependencies and generated artifacts in owning packages", () => {
  const manifest = readJson(path.join(root, "package.json"));
  for (const directory of ["node_modules", ".expo", ".tmp"]) {
    assert.equal(
      existsSync(path.join(root, directory)),
      false,
      directory + " belongs in its owning app or package",
    );
  }
  assert.equal(manifest.workspaces, undefined);
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    assert.equal(manifest[section], undefined, section);
  }
});

test("each app and shared package has a reproducible local install", () => {
  for (const parent of ["apps", "packages"]) {
    for (const entry of readdirSync(path.join(root, parent), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(root, parent, entry.name);
      if (!existsSync(path.join(directory, "package.json"))) continue;
      const manifest = readJson(path.join(directory, "package.json"));
      for (const name of Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      })) {
        assert.ok(
          existsSync(
            path.join(directory, "node_modules", name, "package.json"),
          ),
          directory + " must install " + name + " locally",
        );
      }
      const lock = readJson(path.join(directory, "package-lock.json"));
      assert.equal(lock.name, manifest.name, directory);
      assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
      assert.deepEqual(
        lock.packages[""].devDependencies,
        manifest.devDependencies,
      );
      assert.equal(
        readFileSync(path.join(directory, ".npmrc"), "utf8"),
        readFileSync(path.join(root, ".npmrc"), "utf8"),
      );
    }
  }
});
