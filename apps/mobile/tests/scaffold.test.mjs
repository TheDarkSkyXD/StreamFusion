import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const packageManifest = JSON.parse(readFileSync("package.json", "utf8"));
const appManifest = JSON.parse(readFileSync("app.json", "utf8"));
const easManifest = JSON.parse(readFileSync("eas.json", "utf8"));

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

test("local Android commands stay owned by the Mobile workspace", () => {
  assert.equal(packageManifest.scripts.android, "expo run:android");
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
});
