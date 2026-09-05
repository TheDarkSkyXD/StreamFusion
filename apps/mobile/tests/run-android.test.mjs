import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";

import { runBuildCommand } from "../scripts/build-android-development.mjs";
import {
  acquireWindowsDrive,
  createMappedAndroidEnvironment,
  parseSubstMappings,
  releaseWindowsDrive,
  runWithDriveLease,
} from "../scripts/run-android.mjs";

const require = createRequire(import.meta.url);
const {
  translateResolvedPath,
} = require("../scripts/preserve-subst-paths.cjs");

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

  await assert.rejects(runWithDriveLease(lease, operation), /exited with code/u);
  assert.equal(harness.driveMappings.has("S"), false);
  assert.equal(harness.driveLocks.has("S"), false);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});
