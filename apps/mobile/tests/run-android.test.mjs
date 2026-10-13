import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolveMobileReactNativeCli } from "../scripts/run-android.mjs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertJavaAvailable,
  buildAndroid,
  main as buildDevelopmentAndroid,
  runBuildCommand,
} from "../scripts/build-android-development.mjs";

test("the Windows development launcher builds inside the original project folder", async () => {
  const root = path.join(
    process.cwd(),
    "Android build with spaces",
    "apps",
    "mobile",
  );
  const environment = { USER_SETTING: "preserved" };
  let built = false;
  await buildDevelopmentAndroid(
    root,
    environment,
    async (buildRoot, buildEnvironment) => {
      built = true;
      assert.equal(buildRoot, root);
      assert.equal(buildEnvironment, environment);
    },
  );
  assert.equal(built, true);
});

test("the development launcher reports build failure from the original project folder", async () => {
  const failure = new Error("Gradle failed");
  await assert.rejects(
    buildDevelopmentAndroid(process.cwd(), {}, async () => {
      throw failure;
    }),
    failure,
  );
});

test("the development build checks Java before Gradle starts", async () => {
  let gradleStarted = false;
  await assert.rejects(
    buildAndroid(
      path.join(tmpdir(), "missing-java-mobile"),
      {},
      {
        assertJava() {
          throw new Error("Java is required");
        },
        exists() {
          return false;
        },
        runCommand() {
          gradleStarted = true;
          return Promise.resolve();
        },
      },
    ),
    /Java is required/u,
  );
  assert.equal(gradleStarted, false);
});

test("the development build runs Gradle in the owned Android project", async () => {
  const calls = [];
  const mobileRoot = path.join(tmpdir(), "streamfusion-mobile");
  await buildAndroid(
    mobileRoot,
    { USER_SETTING: "preserved" },
    {
      assertJava() {
        calls.push("java");
      },
      exists(candidate) {
        calls.push(candidate);
        return true;
      },
      runCommand(command, args, cwd, environment) {
        calls.push({ command, args, cwd, environment });
        return Promise.resolve();
      },
    },
  );
  const androidRoot = path.join(mobileRoot, "android");
  assert.equal(calls[0], "java");
  assert.equal(
    calls[1],
    path.join(
      androidRoot,
      process.platform === "win32" ? "gradlew.bat" : "gradlew",
    ),
  );
  assert.equal(calls[2].cwd, androidRoot);
  assert.equal(calls[2].environment.USER_SETTING, "preserved");
  assert.deepEqual(
    calls[2].args,
    process.platform === "win32"
      ? [
          "/d",
          "/s",
          "/c",
          ".\\gradlew.bat app:assembleDebug -PreactNativeDevServerPort=8083",
        ]
      : ["app:assembleDebug", "-PreactNativeDevServerPort=8083"],
  );
});

test("the development build refuses a missing owned Android project", async () => {
  await assert.rejects(
    buildAndroid(
      path.join(tmpdir(), "missing-owned-android"),
      {},
      {
        assertJava() {},
        exists() {
          return false;
        },
        runCommand() {
          throw new Error("Gradle must not start");
        },
      },
    ),
    /owned Android project is missing/u,
  );
});

test("the Java preflight uses JAVA_HOME on Windows and PATH on Linux", () => {
  const commands = [];
  const run = (command, args, options) => {
    commands.push({ args, command, options });
    return { status: 0 };
  };
  assertJavaAvailable({ JAVA_HOME: "C:\\Android Studio\\jbr" }, "win32", run);
  assertJavaAvailable({}, "linux", run);
  assert.deepEqual(
    commands.map((entry) => entry.command),
    ["C:\\Android Studio\\jbr\\bin\\java.exe", "java"],
  );
  assert.deepEqual(
    commands.map((entry) => entry.args),
    [["-version"], ["-version"]],
  );
  assert.equal(commands[0].options.timeout, 10_000);
  assert.equal(commands[1].options.timeout, 10_000);
});

test("the Java preflight contains failed and timed-out commands", () => {
  for (const result of [
    { error: new Error("spawn failed"), status: null },
    { status: 1 },
    { error: new Error("timed out"), status: null },
  ]) {
    assert.throws(
      () => assertJavaAvailable({}, "linux", () => result),
      /Java is required/u,
    );
  }
});

test("a cancelled development build forwards the signal and removes signal handlers", async () => {
  const signals = new EventEmitter();
  const running = runBuildCommand(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    process.cwd(),
    process.env,
    signals,
  );
  setTimeout(() => signals.emit("SIGTERM", "SIGTERM"), 50);
  await assert.rejects(running, /exited with code/u);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

function writeReactNativeCli(root, version) {
  const cliRoot = path.join(
    root,
    "node_modules",
    "@react-native-community",
    "cli",
  );
  mkdirSync(path.join(cliRoot, "build"), { recursive: true });
  writeFileSync(
    path.join(cliRoot, "package.json"),
    JSON.stringify({
      name: "@react-native-community/cli",
      version,
    }),
  );
  writeFileSync(
    path.join(cliRoot, "build", "bin.js"),
    "module.exports = {};\n",
  );
}

function createCliResolutionFixture({ appLocal }) {
  const repositoryRoot = mkdtempSync(
    path.join(tmpdir(), "streamfusion mobile cli fixture "),
  );
  const mobileRoot = path.join(repositoryRoot, "apps", "mobile");
  mkdirSync(mobileRoot, { recursive: true });
  writeFileSync(path.join(mobileRoot, "package.json"), '{"name":"mobile"}');
  writeReactNativeCli(repositoryRoot, "20.2.0");
  if (appLocal) writeReactNativeCli(mobileRoot, "20.2.1");
  return { mobileRoot, repositoryRoot };
}

test("the mobile-local React Native CLI wins over a distinct hoisted version", () => {
  const fixture = createCliResolutionFixture({ appLocal: true });
  try {
    const reactNativeCli = resolveMobileReactNativeCli(
      fixture.mobileRoot,
      fixture.repositoryRoot,
    );
    assert.equal(
      reactNativeCli,
      path.join(
        fixture.mobileRoot,
        "node_modules",
        "@react-native-community",
        "cli",
        "build",
        "bin.js",
      ),
    );
  } finally {
    rmSync(fixture.repositoryRoot, { force: true, recursive: true });
  }
});

test("a hoisted React Native CLI remains valid when it resolves inside the task worktree", () => {
  const fixture = createCliResolutionFixture({ appLocal: false });
  try {
    assert.equal(
      resolveMobileReactNativeCli(fixture.mobileRoot, fixture.repositoryRoot),
      path.join(
        fixture.repositoryRoot,
        "node_modules",
        "@react-native-community",
        "cli",
        "build",
        "bin.js",
      ),
    );
  } finally {
    rmSync(fixture.repositoryRoot, { force: true, recursive: true });
  }
});
