import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageManifest = JSON.parse(readFileSync("package.json", "utf8"));
const appManifest = JSON.parse(readFileSync("app.json", "utf8"));
const easManifest = JSON.parse(readFileSync("eas.json", "utf8"));
const require = createRequire(import.meta.url);

function installedPackageManifest(name) {
  return JSON.parse(
    readFileSync(require.resolve(`${name}/package.json`), "utf8"),
  );
}

test("the development client is Android-only and distinct from production", () => {
  assert.deepEqual(appManifest.expo.platforms, ["android"]);
  assert.equal(
    appManifest.expo.android.package,
    "com.thedarkskyxd.streamfusion.dev",
  );
  assert.notEqual(
    appManifest.expo.android.package,
    "com.thedarkskyxd.streamfusion",
  );
  assert.equal(appManifest.expo.android.versionCode, 1);
  assert.equal(existsSync("ios"), false);
});

test("native app links stay in the single Mobile runtime", () => {
  assert.match(
    readFileSync("app/+native-intent.ts", "utf8"),
    /redirectSystemPath\(\): null/u,
  );
  assert.equal(existsSync("app/[...path].tsx"), false);
});

test("the Android build supports API 30 and custom development clients", () => {
  const buildProperties = appManifest.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties",
  );

  assert.equal(buildProperties?.[1]?.android?.minSdkVersion, 30);
  assert.ok(packageManifest.dependencies["expo-dev-client"]);
  assert.equal(easManifest.build.development.developmentClient, true);
  assert.equal(easManifest.build.development.distribution, "internal");
  assert.equal(easManifest.build.development.android.buildType, "apk");
  assert.equal(easManifest.build.development.autoIncrement, false);
});

test("the Android build enables SQLCipher and excludes all app data from backup", () => {
  const sqlitePlugin = appManifest.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-sqlite",
  );
  const secureStorePlugin = appManifest.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-secure-store",
  );

  assert.equal(appManifest.expo.android.allowBackup, false);
  assert.equal(sqlitePlugin?.[1]?.android?.useSQLCipher, true);
  assert.equal(secureStorePlugin?.[1]?.configureAndroidBackup, true);
  assert.equal(packageManifest.dependencies["expo-crypto"], "57.0.2");
  assert.equal(packageManifest.dependencies["expo-file-system"], "57.0.2");
  assert.equal(packageManifest.dependencies["expo-secure-store"], "57.0.2");
  assert.equal(packageManifest.dependencies["expo-sqlite"], "57.0.2");
});

test("SQLCipher is proven in memory before a persistent database is opened", () => {
  const driverSource = readFileSync(
    "src/persistence/sqlite-encrypted-driver.ts",
    "utf8",
  );
  const probe = driverSource.indexOf('openDatabaseAsync(":memory:"');
  const persistentOpen = driverSource.indexOf(
    "openDatabaseAsync(databaseName)",
  );

  assert.ok(probe >= 0);
  assert.ok(persistentOpen > probe);
});

test("local Android commands stay owned by the Mobile workspace", () => {
  const developmentBuildSource = readFileSync(
    "scripts/build-android-development.mjs",
    "utf8",
  );

  assert.equal(
    packageManifest.scripts.android,
    "node scripts/start-expo-go.mjs",
  );
  assert.equal(
    packageManifest.scripts["android:native"],
    "node scripts/run-android.mjs",
  );
  assert.match(
    packageManifest.scripts["build:android:development"],
    /build-android-development/,
  );
  assert.equal(
    packageManifest.scripts["bundle:android"],
    "expo export --platform android --output-dir dist",
  );
  assert.equal(
    packageManifest.scripts["prebuild:android"],
    "expo prebuild --platform android --no-install",
  );
  assert.match(developmentBuildSource, /process\.env\.ComSpec/u);
  assert.ok(
    developmentBuildSource.includes('".\\\\gradlew.bat app:assembleDebug"'),
  );
});

test("native animation peers match the Expo SDK and resolve without conflicts", () => {
  const expoManifestPath = require.resolve("expo/package.json");
  const bundledNativeModules = JSON.parse(
    readFileSync(
      path.join(path.dirname(expoManifestPath), "bundledNativeModules.json"),
      "utf8",
    ),
  );
  const reanimatedVersion = bundledNativeModules["react-native-reanimated"];
  const workletsVersion = bundledNativeModules["react-native-worklets"];

  assert.equal(
    packageManifest.dependencies["react-native-reanimated"],
    reanimatedVersion,
  );
  assert.equal(
    packageManifest.dependencies["react-native-worklets"],
    workletsVersion,
  );
  assert.equal(
    installedPackageManifest("react-native-reanimated").version,
    reanimatedVersion,
  );
  assert.equal(
    installedPackageManifest("react-native-worklets").version,
    workletsVersion,
  );

  const npmCli = process.env.npm_execpath;
  assert.ok(
    npmCli,
    "npm_execpath must identify the repository's approved npm CLI",
  );
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const peerCheck = spawnSync(
    process.execPath,
    [
      npmCli,
      "ls",
      "expo-modules-core",
      "react-native-reanimated",
      "react-native-worklets",
      "--all",
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.equal(peerCheck.status, 0, peerCheck.stderr || peerCheck.stdout);
});
