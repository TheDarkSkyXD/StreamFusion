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
  ["MediaJobs", "StreamFusionMediaJobs", ["startRecoverableJob", "recoverJobs", "cancelRecoverableJob"]],
  ["Captions", "StreamFusionCaptions", ["installEnglishModel", "startFocusedCaptionSession", "stopFocusedCaptionSession", "removeEnglishModel"]],
  ["Diagnostics", "StreamFusionDiagnostics", ["readResourceSnapshot"]],
  ["Maintenance", "StreamFusionMaintenance", ["verifyDownloadedApk", "handoffVerifiedApk"]],
];

test("the Expo module keeps five narrow Android contracts with contained unsupported results", () => {
  const config = JSON.parse(readFileSync(path.join(moduleRoot, "expo-module.config.json"), "utf8"));
  assert.deepEqual(config.platforms, ["android"]);
  assert.equal(config.android.modules.length, modules.length);
  for (const [className, moduleName, operations] of modules) {
    const source = readFileSync(path.join(kotlinRoot, `StreamFusion${className}Module.kt`), "utf8");
    assert.match(source, new RegExp(`Name\\("${moduleName}"\\)`, "u"));
    assert.match(source, /Function\("getContractVersion"\) \{ 1 \}/u);
    assert.match(source, /"NATIVE_OPERATION_UNSUPPORTED"/u);
    for (const operation of operations) assert.match(source, new RegExp(`AsyncFunction\\("${operation}"\\)`, "u"));
  }
});
