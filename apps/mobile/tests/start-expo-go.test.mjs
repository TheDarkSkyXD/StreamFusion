import assert from "node:assert/strict";
import test from "node:test";

import {
  createAndroidEnvironment,
  createExpoGoArguments,
  createExpoGoIntentArguments,
  parseAdbDevices,
  resolveAndroidSdkRoot,
} from "../scripts/start-expo-go.mjs";

test("the normal Android launcher opens Expo Go without a native build", () => {
  assert.deepEqual(createExpoGoArguments(["--clear"]), [
    "start",
    "--go",
    "--offline",
    "--port",
    "8081",
    "--clear",
  ]);
  assert.equal(createExpoGoArguments([]).includes("run:android"), false);
  assert.equal(createExpoGoArguments([]).includes("--android"), false);
});

test("the launcher bypasses the browser and deep-links Expo Go over ADB", () => {
  assert.deepEqual(createExpoGoIntentArguments(8081, "10.0.2.2"), [
    "-a",
    "android.intent.action.VIEW",
    "-d",
    "exp://10.0.2.2:8081",
    "host.exp.exponent",
  ]);
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
