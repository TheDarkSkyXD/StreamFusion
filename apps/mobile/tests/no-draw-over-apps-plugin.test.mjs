import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  OVERLAY_PERMISSION,
  stripSystemAlertWindowPermission,
} = require("../plugins/with-no-draw-over-apps.js");

test("the no-draw-over-apps plugin strips SYSTEM_ALERT_WINDOW from main", () => {
  const manifest = stripSystemAlertWindowPermission({
    "uses-permission": [
      { $: { "android:name": "android.permission.INTERNET" } },
      { $: { "android:name": OVERLAY_PERMISSION } },
      { $: { "android:name": "android.permission.VIBRATE" } },
    ],
  });
  const names = manifest["uses-permission"].map((entry) => entry.$["android:name"]);
  assert.deepEqual(names, [
    "android.permission.INTERNET",
    "android.permission.VIBRATE",
  ]);
});

test("the no-draw-over-apps plugin is a no-op when overlay is absent", () => {
  const manifest = stripSystemAlertWindowPermission({
    "uses-permission": [
      { $: { "android:name": "android.permission.INTERNET" } },
    ],
  });
  assert.equal(manifest["uses-permission"].length, 1);
});
