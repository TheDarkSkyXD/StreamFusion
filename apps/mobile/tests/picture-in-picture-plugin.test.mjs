import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const require = createRequire(import.meta.url);
const { applyPictureInPictureToManifest } = require("../plugins/with-picture-in-picture.js");

test("the PiP plugin declares Picture-in-Picture on every Android activity", () => {
  const manifest = applyPictureInPictureToManifest({
    application: [
      {
        $: { "android:name": ".MainApplication" },
        activity: [
          {
            $: {
              "android:configChanges": "keyboard|keyboardHidden",
              "android:name": ".MainActivity",
            },
          },
          {
            $: {
              "android:name": "expo.modules.devlauncher.launcher.DevLauncherActivity",
            },
          },
        ],
      },
    ],
  });
  const activities = manifest.application[0].activity;
  assert.equal(manifest.application[0].$["android:resizeableActivity"], "true");
  for (const activity of activities) {
    assert.equal(activity.$["android:supportsPictureInPicture"], "true");
    assert.equal(activity.$["android:resizeableActivity"], "true");
    assert.match(activity.$["android:configChanges"], /orientation/u);
    assert.match(activity.$["android:configChanges"], /screenSize/u);
    assert.match(activity.$["android:configChanges"], /smallestScreenSize/u);
  }
  assert.match(
    activities[0].$["android:configChanges"],
    /keyboard\|keyboardHidden\|/u,
  );
  assert.match(
    activities[0].$["tools:replace"],
    /android:supportsPictureInPicture/u,
  );
  assert.equal(activities[1].$["tools:replace"], undefined);
});
