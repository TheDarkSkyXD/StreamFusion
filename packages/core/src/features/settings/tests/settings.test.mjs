import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PRODUCT_PREFERENCES,
  applyPreferencePatch,
  nativeColorScheme,
  parseProductPreferences,
  searchSettingsControls,
  settingsPanelsFor,
} from "@streamfusion/core/settings";

test("defaults match desktop dark theme, auto quality, and 10s seek", () => {
  assert.equal(DEFAULT_PRODUCT_PREFERENCES.theme, "dark");
  assert.equal(DEFAULT_PRODUCT_PREFERENCES.quality, "auto");
  assert.equal(DEFAULT_PRODUCT_PREFERENCES.rewindSeconds, 10);
  assert.equal(DEFAULT_PRODUCT_PREFERENCES.fastForwardSeconds, 10);
  assert.equal(DEFAULT_PRODUCT_PREFERENCES.lowLatencyMode, false);
  assert.equal(DEFAULT_PRODUCT_PREFERENCES.liveSyncDurationCount, 4);
  assert.equal(DEFAULT_PRODUCT_PREFERENCES.forwardBufferSec, 15);
  assert.equal(DEFAULT_PRODUCT_PREFERENCES.maxBufferSec, 30);
  assert.equal(DEFAULT_PRODUCT_PREFERENCES.multiviewCap, 6);
  assert.equal(DEFAULT_PRODUCT_PREFERENCES.resumePlayback, false);
});

test("unsupported language does not overwrite the saved locale", () => {
  const result = applyPreferencePatch(DEFAULT_PRODUCT_PREFERENCES, {
    language: "fr",
  });
  assert.equal(result.preferences.language, "en");
  assert.equal(result.rejected[0], "Only English is available on this build.");
});

test("light and system theme patches stay dark", () => {
  const result = applyPreferencePatch(DEFAULT_PRODUCT_PREFERENCES, {
    theme: "light",
  });
  assert.equal(result.preferences.theme, "dark");
  assert.equal(
    result.rejected[0],
    "Dark mode is the only appearance on this build.",
  );
  const system = applyPreferencePatch(DEFAULT_PRODUCT_PREFERENCES, {
    theme: "system",
  });
  assert.equal(system.preferences.theme, "dark");
  assert.equal(
    system.rejected[0],
    "Dark mode is the only appearance on this build.",
  );
  const storedLight = parseProductPreferences(
    JSON.stringify({ ...DEFAULT_PRODUCT_PREFERENCES, theme: "light" }),
  );
  assert.equal(storedLight.theme, "dark");
});

test("token player stays native ExoPlayer when another engine is requested", () => {
  const result = applyPreferencePatch(DEFAULT_PRODUCT_PREFERENCES, {
    tokenPlayer: "web-hls",
  });
  assert.equal(result.preferences.tokenPlayer, "native-exoplayer");
  assert.match(result.rejected[0] ?? "", /native ExoPlayer/);
});

test("corrupt JSON falls back to defaults", () => {
  assert.deepEqual(parseProductPreferences("{"), DEFAULT_PRODUCT_PREFERENCES);
  assert.deepEqual(parseProductPreferences(null), DEFAULT_PRODUCT_PREFERENCES);
});

test("local search matches HEVC and player chrome without losing panel order", () => {
  const matches = searchSettingsControls("hevc");
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.id, "hevc");
  const panels = settingsPanelsFor(searchSettingsControls("control"));
  assert.deepEqual(panels, ["player-controls"]);
});

test("local search isolates notifications, adblock, and proxy panels", () => {
  assert.deepEqual(settingsPanelsFor(searchSettingsControls("proxy")), [
    "proxy",
  ]);
  assert.deepEqual(settingsPanelsFor(searchSettingsControls("adblock")), [
    "adblock",
  ]);
  assert.deepEqual(settingsPanelsFor(searchSettingsControls("guest")), [
    "notifications",
  ]);
});

test("local search finds chat, predictions, integrations, and token panels", () => {
  assert.ok(
    settingsPanelsFor(searchSettingsControls("chat")).includes("chat"),
  );
  assert.deepEqual(settingsPanelsFor(searchSettingsControls("predictions")), [
    "chat",
    "predictions",
  ]);
  assert.deepEqual(settingsPanelsFor(searchSettingsControls("integrations")), [
    "integrations",
  ]);
  assert.ok(
    settingsPanelsFor(searchSettingsControls("token")).includes("api-tokens"),
  );
});

test("local search isolates updates, diagnostics, logs, report, and about", () => {
  assert.deepEqual(settingsPanelsFor(searchSettingsControls("github")), [
    "updates",
  ]);
  assert.deepEqual(settingsPanelsFor(searchSettingsControls("bug")), [
    "report-bug",
  ]);
  assert.deepEqual(settingsPanelsFor(searchSettingsControls("privacy")), [
    "about",
  ]);
  assert.deepEqual(settingsPanelsFor(searchSettingsControls("runtime")), [
    "logs",
  ]);
});

test("native color scheme stays dark", () => {
  assert.equal(nativeColorScheme("system"), "dark");
  assert.equal(nativeColorScheme("light"), "dark");
  assert.equal(nativeColorScheme("dark"), "dark");
});
