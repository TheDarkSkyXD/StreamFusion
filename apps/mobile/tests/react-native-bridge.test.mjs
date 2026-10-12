import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve("modules/streamfusion-native-contracts");
const android = path.join(root, "android/src/main/java/expo/modules/streamfusionnativecontracts");

test("native contracts use the React Native bridge and preserve module identities", () => {
  const bridge = readFileSync(path.join(root, "src/contracts.ts"), "utf8");
  const registry = readFileSync(path.join(android, "StreamFusionPackage.kt"), "utf8");
  assert.match(bridge, /NativeModules/u);
  assert.match(bridge, /NativeEventEmitter/u);
  assert.doesNotMatch(bridge, /from ["']expo["']/u);
  for (const name of ["Playback", "MediaJobs", "Captions", "Diagnostics", "Maintenance", "Connectivity", "Updater"]) {
    const source = readFileSync(path.join(android, `StreamFusion${name}Module.kt`), "utf8");
    assert.match(source, /ReactContextBaseJavaModule/u);
    assert.match(source, new RegExp(`getName\\(\\).*StreamFusion${name}`, "us"));
    assert.doesNotMatch(source, /import expo\.modules/u);
    assert.match(registry, new RegExp(`StreamFusion${name}Module\\(`, "u"));
  }
  const view = readFileSync(path.join(android, "StreamFusionPlaybackView.kt"), "utf8");
  assert.doesNotMatch(view, /ExpoView|import expo\.modules/u);
  assert.match(registry, /SimpleViewManager<StreamFusionPlaybackView>/u);
});
