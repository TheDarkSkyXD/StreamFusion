import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildAndroid,
  runBuildCommand,
} from "../scripts/build-android-development.mjs";
import {
  acquireWindowsDrive,
  assertJavaAvailable,
  createMappedAndroidEnvironment,
  mapWorktreePathToDriveLease,
  parseSubstMappings,
  releaseWindowsDrive,
  resolveMobileExpoCli,
  runWithDriveLease,
} from "../scripts/run-android.mjs";

const require = createRequire(import.meta.url);
const {
  translateResolvedPath,
} = require("../scripts/preserve-subst-paths.cjs");

function writeExpoCli(root, version) {
  const expoRoot = path.join(root, "node_modules", "expo");
  mkdirSync(path.join(expoRoot, "bin"), { recursive: true });
  writeFileSync(
    path.join(expoRoot, "package.json"),
    JSON.stringify({
      exports: { "./bin/cli": "./bin/cli.js" },
      name: "expo",
      version,
    }),
  );
  writeFileSync(path.join(expoRoot, "bin", "cli.js"), "export {};\n");
}

function createExpoResolutionFixture({ appLocal }) {
  const repositoryRoot = mkdtempSync(
    path.join(tmpdir(), "streamfusion mobile cli fixture "),
  );
  const mobileRoot = path.join(repositoryRoot, "apps", "mobile");
  mkdirSync(mobileRoot, { recursive: true });
  writeFileSync(path.join(mobileRoot, "package.json"), '{"name":"mobile"}');
  writeExpoCli(repositoryRoot, "57.0.15");
  if (appLocal) writeExpoCli(mobileRoot, "57.0.17");
  return { mobileRoot, repositoryRoot };
}

function createDriveHarness({
  mappings = [],
  locks = [],
  liveProcesses = [],
} = {}) {
  const driveMappings = new Map(mappings);
  const driveLocks = new Map(locks);
  const liveProcessIds = new Set(liveProcesses);
  const events = [];
  let tokenSequence = 0;

  return {
    driveLocks,
    driveMappings,
    events,
    overrides: {
      candidates: ["S", "R"],
      createLock(drive, record) {
        if (driveLocks.has(drive)) {
          return false;
        }
        driveLocks.set(drive, record);
        events.push(`lock:${drive}`);
        return true;
      },
      createToken() {
        tokenSequence += 1;
        return `token-${tokenSequence}`;
      },
      deleteLock(drive) {
        driveLocks.delete(drive);
        events.push(`unlock:${drive}`);
      },
      driveExists() {
        return false;
      },
      isProcessAlive(processId) {
        return liveProcessIds.has(processId);
      },
      listMappings() {
        return new Map(driveMappings);
      },
      mapDrive(drive, target) {
        if (driveMappings.has(drive)) {
          return false;
        }
        driveMappings.set(drive, target);
        events.push(`map:${drive}`);
        return true;
      },
      processId: 42,
      readLock(drive) {
        return driveLocks.get(drive);
      },
      unmapDrive(drive) {
        driveMappings.delete(drive);
        events.push(`unmap:${drive}`);
        return true;
      },
    },
  };
}

test("subst output is parsed without changing mapped targets", () => {
  const mappings = parseSubstMappings(
    "S:\\: => F:\\source repository\r\nR:\\: => C:\\other\r\n",
  );

  assert.deepEqual(
    [...mappings],
    [
      ["S", "F:\\source repository"],
      ["R", "C:\\other"],
    ],
  );
});

test("real paths inside the repository remain on the leased drive", () => {
  const targetRoot = "F:\\a very long repository";

  assert.equal(
    translateResolvedPath(
      "F:\\a very long repository\\node_modules\\react-native",
      targetRoot,
      "S:\\",
    ),
    "S:\\node_modules\\react-native",
  );
  assert.equal(
    translateResolvedPath("C:\\Android\\Sdk", targetRoot, "S:\\"),
    "C:\\Android\\Sdk",
  );
});

test("the mapped Expo process preloads consistent realpath handling", () => {
  const environment = createMappedAndroidEnvironment(
    { drive: "S", repositoryRoot: "F:\\StreamFusion" },
    { NODE_OPTIONS: "--trace-warnings", USER_SETTING: "preserved" },
  );

  assert.equal(environment.USER_SETTING, "preserved");
  assert.equal(
    environment.NODE_OPTIONS,
    "--trace-warnings --require=S:\\apps\\mobile\\scripts\\preserve-subst-paths.cjs",
  );
  assert.equal(environment.STREAMFUSION_SUBST_DRIVE_ROOT, "S:\\");
  assert.equal(environment.STREAMFUSION_SUBST_TARGET_ROOT, "F:\\StreamFusion");
});

test("the mobile-local Expo CLI wins over a distinct hoisted version and maps to the leased drive", () => {
  const fixture = createExpoResolutionFixture({ appLocal: true });
  try {
    const expoCli = resolveMobileExpoCli(
      fixture.mobileRoot,
      fixture.repositoryRoot,
    );
    assert.equal(
      expoCli,
      path.join(fixture.mobileRoot, "node_modules", "expo", "bin", "cli.js"),
    );
    assert.equal(
      mapWorktreePathToDriveLease(expoCli, {
        drive: "S",
        repositoryRoot: fixture.repositoryRoot,
      }),
      "S:\\apps\\mobile\\node_modules\\expo\\bin\\cli.js",
    );
  } finally {
    rmSync(fixture.repositoryRoot, { force: true, recursive: true });
  }
});

test("a hoisted Expo CLI remains valid when it resolves inside the task worktree", () => {
  const fixture = createExpoResolutionFixture({ appLocal: false });
  try {
    assert.equal(
      resolveMobileExpoCli(fixture.mobileRoot, fixture.repositoryRoot),
      path.join(
        fixture.repositoryRoot,
        "node_modules",
        "expo",
        "bin",
        "cli.js",
      ),
    );
  } finally {
    rmSync(fixture.repositoryRoot, { force: true, recursive: true });
  }
});

test("a resolved Expo CLI outside the task worktree is rejected before mapping", () => {
  const fixture = createExpoResolutionFixture({ appLocal: false });
  const outsideRoot = mkdtempSync(path.join(tmpdir(), "outside expo cli "));
  try {
    const outsideCli = path.join(outsideRoot, "cli.js");
    writeFileSync(outsideCli, "export {};\n");
    assert.throws(
      () =>
        mapWorktreePathToDriveLease(outsideCli, {
          drive: "S",
          repositoryRoot: fixture.repositoryRoot,
        }),
      /inside the task worktree/u,
    );
  } finally {
    rmSync(fixture.repositoryRoot, { force: true, recursive: true });
    rmSync(outsideRoot, { force: true, recursive: true });
  }
});

test("the development build checks Java before prebuild can create Android output", async () => {
  let prebuildStarted = false;
  await assert.rejects(
    buildAndroid(
      path.join(tmpdir(), "missing-java-mobile"),
      "expo-cli",
      {},
      {
        assertJava() {
          throw new Error("Java is required");
        },
        exists() {
          return false;
        },
        runCommand() {
          prebuildStarted = true;
          return Promise.resolve();
        },
      },
    ),
    /Java is required/u,
  );
  assert.equal(prebuildStarted, false);
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

test("a lease releases when resolved CLI path mapping fails", async () => {
  const fixture = createExpoResolutionFixture({ appLocal: false });
  const outsideRoot = mkdtempSync(path.join(tmpdir(), "outside expo cli "));
  const harness = createDriveHarness();
  const lease = acquireWindowsDrive(fixture.repositoryRoot, harness.overrides);
  try {
    const outsideCli = path.join(outsideRoot, "cli.js");
    writeFileSync(outsideCli, "export {};\n");
    await assert.rejects(
      runWithDriveLease(lease, () =>
        mapWorktreePathToDriveLease(outsideCli, lease),
      ),
      /inside the task worktree/u,
    );
    assert.equal(harness.driveMappings.has("S"), false);
    assert.equal(harness.driveLocks.has("S"), false);
  } finally {
    rmSync(fixture.repositoryRoot, { force: true, recursive: true });
    rmSync(outsideRoot, { force: true, recursive: true });
  }
});

test("an occupied drive is preserved and the next drive is leased", () => {
  const harness = createDriveHarness({ mappings: [["S", "C:\\existing"]] });
  const lease = acquireWindowsDrive("F:\\StreamFusion", harness.overrides);

  assert.equal(lease.drive, "R");
  assert.equal(harness.driveMappings.get("S"), "C:\\existing");
  assert.equal(harness.driveMappings.get("R"), "F:\\StreamFusion");

  releaseWindowsDrive(lease);
  assert.equal(harness.driveMappings.has("R"), false);
  assert.equal(harness.driveMappings.get("S"), "C:\\existing");
});

test("an unverified mapping is rolled back when it becomes visible", () => {
  const harness = createDriveHarness();
  const listMappings = harness.overrides.listMappings;
  let inspectionCount = 0;
  harness.overrides.listMappings = () => {
    inspectionCount += 1;
    if (inspectionCount === 3) {
      return new Map();
    }
    return listMappings();
  };

  const lease = acquireWindowsDrive("F:\\StreamFusion", harness.overrides);

  assert.equal(lease.drive, "R");
  assert.deepEqual(harness.events.slice(0, 6), [
    "lock:S",
    "map:S",
    "unmap:S",
    "unlock:S",
    "lock:R",
    "map:R",
  ]);
});

test("a mapping replaced during verification is never removed", () => {
  const harness = createDriveHarness();
  const listMappings = harness.overrides.listMappings;
  let inspectionCount = 0;
  harness.overrides.listMappings = () => {
    inspectionCount += 1;
    if (inspectionCount === 3) {
      harness.driveMappings.set("S", "C:\\replacement");
    }
    return listMappings();
  };

  const lease = acquireWindowsDrive("F:\\StreamFusion", harness.overrides);

  assert.equal(lease.drive, "R");
  assert.equal(harness.driveMappings.get("S"), "C:\\replacement");
  assert.equal(harness.events.includes("unmap:S"), false);
});

test("a dead launcher's mapping is reconciled before the drive is reused", () => {
  const staleLock = {
    processId: 99,
    repositoryRoot: "F:\\StreamFusion",
    token: "stale-token",
  };
  const harness = createDriveHarness({
    locks: [["S", staleLock]],
    mappings: [["S", "F:\\StreamFusion"]],
  });

  const lease = acquireWindowsDrive("F:\\StreamFusion", harness.overrides);

  assert.equal(lease.drive, "S");
  assert.deepEqual(harness.events.slice(0, 4), [
    "unmap:S",
    "unlock:S",
    "lock:S",
    "map:S",
  ]);
  assert.notEqual(harness.driveLocks.get("S").token, "stale-token");
});

test("a live launcher lease is preserved", () => {
  const harness = createDriveHarness({
    liveProcesses: [99],
    locks: [
      [
        "S",
        {
          processId: 99,
          repositoryRoot: "F:\\StreamFusion",
          token: "live-token",
        },
      ],
    ],
    mappings: [["S", "F:\\StreamFusion"]],
  });

  const lease = acquireWindowsDrive("F:\\StreamFusion", harness.overrides);

  assert.equal(lease.drive, "R");
  assert.equal(harness.driveLocks.get("S").token, "live-token");
  assert.equal(harness.events.includes("unmap:S"), false);
});

test("the drive is released after normal completion and child failure", async () => {
  for (const childError of [undefined, new Error("child failed")]) {
    const harness = createDriveHarness();
    const lease = acquireWindowsDrive("F:\\StreamFusion", harness.overrides);

    const operation = async () => {
      if (childError) {
        throw childError;
      }
    };

    if (childError) {
      await assert.rejects(runWithDriveLease(lease, operation), childError);
    } else {
      await runWithDriveLease(lease, operation);
    }

    assert.equal(harness.driveMappings.has("S"), false);
    assert.equal(harness.driveLocks.has("S"), false);
  }
});

test("a cancelled development build forwards the signal and releases its drive", async () => {
  const harness = createDriveHarness();
  const lease = acquireWindowsDrive("F:\\StreamFusion", harness.overrides);
  const signals = new EventEmitter();

  const operation = () => {
    const running = runBuildCommand(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      process.cwd(),
      process.env,
      signals,
    );
    setTimeout(() => signals.emit("SIGTERM", "SIGTERM"), 50);
    return running;
  };

  await assert.rejects(
    runWithDriveLease(lease, operation),
    /exited with code/u,
  );
  assert.equal(harness.driveMappings.has("S"), false);
  assert.equal(harness.driveLocks.has("S"), false);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});
