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
  ["Playback", "StreamFusionPlayback", ["startFocusedSession", "enterPictureInPicture", "endFocusedSession"]],
  ["MediaJobs", "StreamFusionMediaJobs", ["startRecoverableJob", "recoverJobs", "cancelRecoverableJob", "pauseRecoverableJob", "resumeRecoverableJob", "retryRecoverableJob", "finalizeRecoverableJob", "getRecoverableJob"]],
  ["Captions", "StreamFusionCaptions", ["installEnglishModel", "startFocusedCaptionSession", "stopFocusedCaptionSession", "removeEnglishModel"]],
  ["Diagnostics", "StreamFusionDiagnostics", ["queueDevelopmentResourceSnapshotFailure", "readResourceSnapshot"]],
  ["Maintenance", "StreamFusionMaintenance", ["verifyDownloadedApk", "handoffVerifiedApk"]],
];

test("the Expo module keeps four contained stubs and one measured diagnostics contract", () => {
  const config = JSON.parse(readFileSync(path.join(moduleRoot, "expo-module.config.json"), "utf8"));
  assert.deepEqual(config.platforms, ["android"]);
  assert.equal(config.android.modules.length, modules.length);
  for (const [className, moduleName, operations] of modules) {
    const source = readFileSync(path.join(kotlinRoot, `StreamFusion${className}Module.kt`), "utf8");
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
    for (const operation of operations) assert.match(source, new RegExp(`AsyncFunction\\("${operation}"\\)`, "u"));
  }
});
