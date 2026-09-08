import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDevelopmentClientIntentStarted,
  assertDevelopmentClientVersion,
  createAndroidEnvironment,
  createDevelopmentClientArguments,
  createDevelopmentClientIntentArguments,
  parseAdbDevices,
  parseInstalledDevelopmentClient,
  resolveAndroidSdkRoot,
} from "../scripts/start-development-client.mjs";

test("the normal Android launcher opens the development client without a native build", () => {
  assert.deepEqual(createDevelopmentClientArguments(["--clear"]), [
    "start",
    "--dev-client",
    "--offline",
    "--port",
    "8081",
    "--clear",
  ]);
  assert.equal(
    createDevelopmentClientArguments([]).includes("run:android"),
    false,
  );
  assert.equal(
    createDevelopmentClientArguments([]).includes("--android"),
    false,
  );
  assert.throws(
    () => createDevelopmentClientArguments(["--go"]),
    /--go is reserved/u,
  );
});

test("missing and mismatched client versions give explicit build guidance", () => {
  const expected = { versionCode: 1, versionName: "0.1.0" };
  assert.doesNotThrow(() =>
    assertDevelopmentClientVersion(
      { versionCode: 1, versionName: "0.1.0" },
      expected,
    ),
  );
  for (const installed of [null, { versionCode: 2, versionName: "0.2.0" }]) {
    assert.throws(
      () => assertDevelopmentClientVersion(installed, expected),
      /npm run mobile:native.*Rebuild after native module changes/u,
    );
  }
});

test("the launcher deep-links the installed development client over ADB", () => {
  assert.deepEqual(createDevelopmentClientIntentArguments(8081, "10.0.2.2"), [
    "-a",
    "android.intent.action.VIEW",
    "-d",
    "exp+streamfusion-development://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081",
    "com.thedarkskyxd.streamfusion.dev",
  ]);
});

test("an exit-zero Android intent failure cannot be reported as opened", () => {
  assert.throws(
    () =>
      assertDevelopmentClientIntentStarted(
        "Error: Activity not started, unable to resolve Intent { act=android.intent.action.VIEW dat=streamfusion-launcher-invalid://probe pkg=com.thedarkskyxd.streamfusion.dev }",
      ),
    /could not open.*npm run mobile:native.*Rebuild after native module changes/u,
  );
  assert.doesNotThrow(() =>
    assertDevelopmentClientIntentStarted(
      "Starting: Intent { act=android.intent.action.VIEW }\nStatus: ok\nLaunchState: COLD\nActivity: com.thedarkskyxd.streamfusion.dev\/.MainActivity\nTotalTime: 740",
    ),
  );
});

test("installed development-client identity must match the app configuration", () => {
  assert.deepEqual(
    parseInstalledDevelopmentClient(
      "versionCode=1 minSdk=30\nversionName=0.1.0\n",
    ),
    { versionCode: 1, versionName: "0.1.0" },
  );
  assert.equal(parseInstalledDevelopmentClient("Unable to find package"), null);
});

test("only ready ADB devices are considered for launch", () => {
  assert.deepEqual(
    parseAdbDevices(
      "List of devices attached\r\nemulator-5554 device product:sdk\r\nemulator-5556 offline\r\n",
    ),
    ["emulator-5554"],
  );
});

test("the installed Windows Android SDK is discovered without shell configuration", () => {
  const home = "C:\\Users\\developer";
  const defaultSdk = "C:\\Users\\developer\\AppData\\Local\\Android\\Sdk";

  assert.equal(
    resolveAndroidSdkRoot({
      environment: {},
      home,
      platform: "win32",
      pathExists: (candidate) => candidate === defaultSdk,
    }),
    defaultSdk,
  );
});

test("an explicit Android SDK is validated instead of silently ignored", () => {
  assert.throws(
    () =>
      resolveAndroidSdkRoot({
        environment: { ANDROID_HOME: "C:\\missing-sdk" },
        pathExists: () => false,
      }),
    /ANDROID_HOME points to a missing Android SDK/u,
  );
});

test("Expo receives Android SDK tools while preserving the caller environment", () => {
  const environment = createAndroidEnvironment(
    "C:\\Android\\Sdk",
    { Path: "C:\\Windows", USER_SETTING: "preserved" },
    "win32",
  );

  assert.equal(environment.ANDROID_HOME, "C:\\Android\\Sdk");
  assert.equal(environment.ANDROID_SDK_ROOT, "C:\\Android\\Sdk");
  assert.equal(environment.USER_SETTING, "preserved");
  assert.equal(
    environment.Path,
    "C:\\Android\\Sdk\\emulator;C:\\Android\\Sdk\\platform-tools;C:\\Windows",
  );
});
