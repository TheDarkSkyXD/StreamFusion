import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const mobile = new URL("../", import.meta.url);
const readJson = (url) => JSON.parse(readFileSync(url, "utf8"));
const isExpo = (name) =>
  name === "expo" || name.startsWith("expo-") || name.startsWith("@expo/");

test("production mobile source has no Expo imports", () => {
  const mobileRoot = fileURLToPath(mobile);
  for (const directory of ["src", "modules", "scripts"]) {
    const files = ts.sys.readDirectory(
      path.join(mobileRoot, directory),
      [".ts", ".tsx", ".js", ".cjs", ".mjs"],
      ["**/tests/**", "**/test-support/**", "**/build/**"],
    );
    for (const file of files) {
      for (const imported of ts.preProcessFile(
        readFileSync(file, "utf8"),
        true,
        true,
      ).importedFiles) {
        assert.equal(
          isExpo(imported.fileName.split("/")[0]) ||
            imported.fileName.startsWith("@expo/"),
          false,
          `${file} imports ${imported.fileName}`,
        );
      }
    }
  }
});

test("the installed mobile dependency graph runs without Expo", () => {
  const seen = new Set();
  function visit(manifestUrl) {
    const require = createRequire(manifestUrl);
    const manifest = readJson(manifestUrl);
    assert.deepEqual(
      Object.keys(manifest.dependencies ?? {}).filter(isExpo),
      [],
      `${manifest.name} requires Expo`,
    );
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      assert.equal(isExpo(name), false, `${manifest.name} requires ${name}`);
      const file = require.resolve
        .paths(name)
        ?.map((directory) => path.join(directory, name, "package.json"))
        .find(existsSync);
      assert.ok(file, `${name} must be installed`);
      if (seen.has(file)) continue;
      seen.add(file);
      visit(pathToFileURL(file));
    }
  }
  visit(new URL("package.json", mobile));
  const lock = readJson(new URL("package-lock.json", mobile));
  const expoPackages = Object.keys(lock.packages).filter((name) =>
    /(?:^|\/)node_modules\/(?:expo(?:-|$)|@expo\/)/u.test(name),
  );
  assert.deepEqual(
    expoPackages,
    [],
    "the mobile lockfile retains Expo packages",
  );
});

test("Android builds use the React Native entry and owned native project", () => {
  const settings = readFileSync(
    new URL("android/settings.gradle", mobile),
    "utf8",
  );
  const app = readFileSync(new URL("android/app/build.gradle", mobile), "utf8");
  assert.doesNotMatch(settings + app, /expo/iu);
  const entry = readFileSync(new URL("index.js", mobile), "utf8");
  assert.match(settings, /com\.facebook\.react\.settings/u);
  assert.match(entry, /AppRegistry\.registerComponent/u);
  assert.doesNotMatch(entry, /expo/iu);
});
