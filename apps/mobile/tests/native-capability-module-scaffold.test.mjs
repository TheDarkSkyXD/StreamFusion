import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const moduleRoot = path.resolve("modules/streamfusion-native-contracts");
const kotlinRoot = path.join(
  moduleRoot,
  "android/src/main/java/expo/modules/streamfusionnativecontracts",
);
const modules = [
  [
    "Playback",
    "StreamFusionPlayback",
    ["startFocusedSession", "enterPictureInPicture", "endFocusedSession"],
  ],
  [
    "MediaJobs",
    "StreamFusionMediaJobs",
    [
      "startRecoverableJob",
      "recoverJobs",
      "cancelRecoverableJob",
      "pauseRecoverableJob",
      "resumeRecoverableJob",
      "retryRecoverableJob",
      "finalizeRecoverableJob",
      "getRecoverableJob",
    ],
  ],
  [
    "Captions",
    "StreamFusionCaptions",
    [
      "installEnglishModel",
      "startFocusedCaptionSession",
      "stopFocusedCaptionSession",
      "removeEnglishModel",
    ],
  ],
  [
    "Diagnostics",
    "StreamFusionDiagnostics",
    ["queueDevelopmentResourceSnapshotFailure", "readResourceSnapshot"],
  ],
  [
    "Maintenance",
    "StreamFusionMaintenance",
    ["verifyDownloadedApk", "handoffVerifiedApk"],
  ],
];

test("Media Job ids reject path traversal before journal and artifact IO", () => {
  const codec = readFileSync(path.join(kotlinRoot, "MediaJobCodec.kt"), "utf8");
  const match = codec.match(
    /JOB_ID = Regex\("(\^\[a-zA-Z0-9\._:-\]\{1,256\}\$)"\)/u,
  );
  assert.ok(match);
  const jobId = new RegExp(match[1], "u");
  assert.equal(jobId.test("download-1"), true);
  assert.equal(jobId.test("../etc"), false);
  assert.equal(jobId.test("foo/bar"), false);
  assert.equal(jobId.test("foo\\bar"), false);
  assert.equal(jobId.test("."), true);
  assert.equal(jobId.test(".."), true);
  assert.match(codec, /jobId != "\." && jobId != "\.\."/u);
});

test("the Media Job engine fences generation, writes journals atomically, and stops empty sticky restarts", () => {
  const engine = readFileSync(
    path.join(kotlinRoot, "MediaJobEngine.kt"),
    "utf8",
  );
  const codec = readFileSync(path.join(kotlinRoot, "MediaJobCodec.kt"), "utf8");
  const service = readFileSync(
    path.join(kotlinRoot, "MediaJobForegroundService.kt"),
    "utf8",
  );
  assert.match(codec, /\.tmp/u);
  assert.match(codec, /renameTo/u);
  assert.match(codec, /AtomicFile/u);
  assert.match(codec, /finishWrite/u);
  assert.match(codec, /json\.isNull\(key\)/u);
  assert.match(codec, /JOB_ID = Regex\("\^\[a-zA-Z0-9\._:-\]\{1,256\}\$"\)/u);
  assert.match(codec, /jobId != "\."/u);
  assert.match(codec, /jobId != "\.\."/u);
  assert.match(
    engine,
    /if \(!MediaJobCodec\.isValidJobId\(jobId\)\) return null/u,
  );
  assert.match(engine, /canonicalFile/u);
  assert.match(engine, /writeIfWorkerOwns/u);
  assert.match(engine, /completeIfWorkerOwns/u);
  assert.match(engine, /synchronized\(journalGuard\)/u);
  assert.match(engine, /journal\.optInt\("generation"\) != generation/u);
  assert.match(engine, /if \(workerRunning\) "pausing" else "paused"/u);
  assert.match(engine, /fun restoreOwnedJobs/u);
  assert.match(service, /START_NOT_STICKY/u);
  assert.match(service, /intent == null/u);
  assert.match(service, /restoreOwnedJobs/u);
});

test("the Expo module keeps four contained stubs and one measured diagnostics contract", () => {
  const config = JSON.parse(
    readFileSync(path.join(moduleRoot, "expo-module.config.json"), "utf8"),
  );
  assert.deepEqual(config.platforms, ["android"]);
  assert.equal(config.android.modules.length, modules.length);
  for (const [className, moduleName, operations] of modules) {
    const source = readFileSync(
      path.join(kotlinRoot, `StreamFusion${className}Module.kt`),
      "utf8",
    );
    assert.match(source, new RegExp(`Name\\("${moduleName}"\\)`, "u"));
    assert.match(
      source,
      className === "Diagnostics"
        ? /Function\("getContractVersion"\) \{ 3 \}/u
        : className === "MediaJobs"
          ? /Function\("getContractVersion"\) \{ 2 \}/u
          : /Function\("getContractVersion"\) \{ 1 \}/u,
    );
    if (className === "Diagnostics") {
      assert.match(source, /ActivityManager\.MemoryInfo/u);
      assert.match(source, /AtomicBoolean/u);
      assert.match(source, /BuildConfig\.DEBUG/u);
      assert.match(source, /compareAndSet\(true, false\)/u);
      assert.match(source, /MediaCodecList/u);
      assert.match(source, /PowerManager\.THERMAL_STATUS_SHUTDOWN/u);
      assert.match(source, /StatFs/u);
    } else if (className === "MediaJobs") {
      assert.doesNotMatch(source, /NATIVE_OPERATION_UNSUPPORTED/u);
    } else {
      assert.match(source, /"NATIVE_OPERATION_UNSUPPORTED"/u);
    }
    for (const operation of operations)
      assert.match(
        source,
        new RegExp(`AsyncFunction\\("${operation}"\\)`, "u"),
      );
  }
});
