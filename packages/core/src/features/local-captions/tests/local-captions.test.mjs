import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  LOCAL_CAPTION_DISPLAY_SIZE,
  LOCAL_CAPTION_DOWNLOAD_BYTES,
  LOCAL_CAPTION_FIXTURE_FILES,
  LOCAL_CAPTION_ONE_SESSION_STATUS,
  LOCAL_CAPTION_PRODUCT_FILES,
  grantCaptionSession,
  isCaptionConstrainedUri,
  isCaptionFixtureUri,
  releaseCaptionSession,
} from "@streamfusion/core/local-captions";

test("English catalog stays 43.11 MiB with pinned product hashes", () => {
  assert.equal(LOCAL_CAPTION_DISPLAY_SIZE, "43.11 MiB");
  assert.equal(LOCAL_CAPTION_DOWNLOAD_BYTES, 45_202_074);
  const total = LOCAL_CAPTION_PRODUCT_FILES.reduce(
    (sum, file) => sum + file.size,
    0,
  );
  assert.equal(total, LOCAL_CAPTION_DOWNLOAD_BYTES);
  assert.equal(LOCAL_CAPTION_PRODUCT_FILES.length, 4);
});

test("fixture files hash to the recorded SHA-256 values", () => {
  for (const file of LOCAL_CAPTION_FIXTURE_FILES) {
    assert.equal(
      createHash("sha256").update(file.contents, "utf8").digest("hex"),
      file.sha256,
    );
  }
});

test("one caption session is leased at a time", () => {
  const first = grantCaptionSession({
    activeSessionId: null,
    reason: LOCAL_CAPTION_ONE_SESSION_STATUS,
    sessionId: "cap-twitch-1",
  });
  assert.deepEqual(first, { kind: "granted", sessionId: "cap-twitch-1" });
  const second = grantCaptionSession({
    activeSessionId: "cap-twitch-1",
    reason: LOCAL_CAPTION_ONE_SESSION_STATUS,
    sessionId: "cap-kick-2",
  });
  assert.deepEqual(second, {
    kind: "rejected",
    reason: LOCAL_CAPTION_ONE_SESSION_STATUS,
  });
  assert.equal(
    releaseCaptionSession({
      activeSessionId: "cap-twitch-1",
      sessionId: "cap-twitch-1",
    }),
    null,
  );
});

test("fixture URIs stay local caption work, not uploads", () => {
  assert.equal(isCaptionFixtureUri("streamfusion-fixture://captions"), true);
  assert.equal(
    isCaptionConstrainedUri("streamfusion-fixture://captions?constrained"),
    true,
  );
  assert.equal(isCaptionFixtureUri("https://huggingface.co/model"), false);
});
