import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const packageManifest = JSON.parse(readFileSync("package.json", "utf8"));
const nativeConfig = JSON.parse(readFileSync("native-config.json", "utf8"));
const buildGradle = readFileSync("android/app/build.gradle", "utf8");
const projectGradle = readFileSync("android/build.gradle", "utf8");
const manifest = readFileSync(
  "android/app/src/main/AndroidManifest.xml",
  "utf8",
);

test("development has an Android-only identity distinct from production", () => {
  assert.deepEqual(nativeConfig.platforms, ["android"]);
  assert.equal(
    nativeConfig.android.package,
    "com.thedarkskyxd.streamfusion.dev",
  );
  assert.notEqual(
    nativeConfig.android.package,
    "com.thedarkskyxd.streamfusion",
  );
  assert.equal(nativeConfig.version, packageManifest.version);
  assert.equal(existsSync("ios"), false);
});

test("the owned native project registers the app's main entry", () => {
  assert.equal(packageManifest.main, "index.js");
  assert.match(
    readFileSync("index.js", "utf8"),
    /AppRegistry\.registerComponent\("main",/u,
  );
  assert.match(buildGradle, /entryFile = file\("\.\.\/\.\.\/index\.js"\)/u);
  assert.match(manifest, /android:name="\.MainActivity"/u);
  assert.match(manifest, /android\.intent\.action\.MAIN/u);
  assert.match(manifest, /android\.intent\.category\.LAUNCHER/u);
});

test("the Android build supports API 30 and uses its owned Gradle project", () => {
  assert.equal(nativeConfig.android.minSdkVersion, 30);
  assert.match(projectGradle, /minSdkVersion = 30/u);
  assert.match(buildGradle, /minSdkVersion rootProject\.ext\.minSdkVersion/u);
  assert.equal(existsSync("android/gradlew.bat"), true);
  assert.equal(packageManifest.scripts.start, "react-native start --port 8083");
  assert.equal(
    packageManifest.scripts.android,
    "node scripts/start-development-client.mjs",
  );
  assert.equal(
    packageManifest.scripts["android:native"],
    "node scripts/run-android.mjs",
  );
  assert.equal(
    packageManifest.scripts["build:android:development"],
    "node scripts/build-android-development.mjs",
  );
  assert.equal(
    packageManifest.scripts["bundle:android"],
    "node scripts/bundle-android.mjs",
  );
});

test("the Android manifest keeps overlay permission out and supports callbacks", () => {
  assert.doesNotMatch(manifest, /android\.permission\.SYSTEM_ALERT_WINDOW/u);
  assert.match(manifest, /android:scheme="\$\{appScheme\}"/u);
  assert.match(manifest, /android\.permission\.INTERNET/u);
  assert.match(manifest, /android\.permission\.VIBRATE/u);
});

test("Android excludes app data from backup", () => {
  assert.equal(nativeConfig.android.allowBackup, false);
  assert.match(manifest, /android:allowBackup="false"/u);
  for (const [attribute, file] of [
    ["fullBackupContent", "secure_store_backup_rules.xml"],
    ["dataExtractionRules", "secure_store_data_extraction_rules.xml"],
  ]) {
    assert.match(
      manifest,
      new RegExp(`android:${attribute}="@xml/${file.slice(0, -4)}"`, "u"),
    );
    assert.equal(
      existsSync(`android/app/src/main/res/xml/${file}`),
      true,
      `${file} must exist for resource linking`,
    );
  }
});

test("native storage uses SQLCipher and checks it before persistent opens", () => {
  const storage = readFileSync(
    "modules/streamfusion-native-contracts/android/src/main/java/expo/modules/streamfusionnativecontracts/StreamFusionStorageModule.kt",
    "utf8",
  );
  assert.match(storage, /net\.zetetic\.database\.sqlcipher\.SQLiteDatabase/u);
  assert.match(storage, /System\.loadLibrary\("sqlcipher"\)/u);
  assert.match(storage, /"PRAGMA cipher_version"/u);
  assert.ok(
    storage.indexOf('System.loadLibrary("sqlcipher")') <
      storage.indexOf("SQLiteDatabase.openDatabase(\n      path.absolutePath"),
  );
});

test("native animation and webp libraries are declared together", () => {
  assert.equal(
    packageManifest.dependencies["react-native-reanimated"],
    "4.5.1",
  );
  assert.equal(packageManifest.dependencies["react-native-worklets"], "0.10.1");
  assert.match(buildGradle, /com\.facebook\.fresco:webpsupport:3\.6\.0/u);
  assert.match(buildGradle, /com\.facebook\.fresco:animated-webp:3\.6\.0/u);
});

test("release and debug builds use distinct signing configurations", () => {
  assert.match(
    buildGradle,
    /debug\s*\{ signingConfig signingConfigs\.debug \}/u,
  );
  assert.match(
    buildGradle,
    /release\s*\{\s*signingConfig signingConfigs\.release/u,
  );
  for (const variable of [
    "STREAMFUSION_UPLOAD_STORE_FILE",
    "STREAMFUSION_UPLOAD_STORE_PASSWORD",
    "STREAMFUSION_UPLOAD_KEY_ALIAS",
    "STREAMFUSION_UPLOAD_KEY_PASSWORD",
  ])
    assert.match(buildGradle, new RegExp(variable, "u"));
});
