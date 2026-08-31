import assert from "node:assert/strict";
import test from "node:test";

import {
  PLATFORMS,
  channelsMatch,
  getChannelKey,
  getChannelNameKey,
  getStreamElementKey,
  getStreamKey,
  streamsMatchChannelIdentity,
} from "@streamfusion/core/platform";

test("platform identities remain scoped to their provider", () => {
  assert.deepEqual(PLATFORMS, ["twitch", "kick"]);
  assert.notEqual(
    getChannelKey({ platform: "twitch", id: "12345" }),
    getChannelKey({ platform: "kick", id: "12345" }),
  );
  assert.equal(
    getChannelKey({ platform: "kick", id: "12345" }),
    getStreamKey({ platform: "kick", channelId: "12345" }),
  );
  assert.equal(
    getChannelNameKey("kick", "xQc"),
    getChannelNameKey("kick", "XQC"),
  );
  assert.notEqual(
    getStreamElementKey({ platform: "kick", id: "live-1" }),
    getStreamElementKey({ platform: "twitch", id: "live-1" }),
  );
});

test("channel matching prefers a provider id and falls back to a normalized slug", () => {
  assert.equal(
    channelsMatch(
      { platform: "twitch", id: "42", username: "old_handle" },
      { platform: "twitch", id: "42", username: "new_handle" },
    ),
    true,
  );
  assert.equal(
    channelsMatch(
      { platform: "kick", id: "421500", username: "xQc" },
      { platform: "kick", id: "411439", username: "XQC" },
    ),
    true,
  );
  assert.equal(
    channelsMatch(
      { platform: "twitch", id: "42", username: "xqc" },
      { platform: "kick", id: "42", username: "xqc" },
    ),
    false,
  );
  assert.equal(
    channelsMatch(
      { platform: "kick", id: "", username: "" },
      { platform: "kick", id: "", username: "" },
    ),
    false,
  );
});

test("stream identity matching uses the same provider and channel rules", () => {
  assert.equal(
    streamsMatchChannelIdentity(
      { platform: "kick", channelId: "1", channelName: "xQc" },
      { platform: "kick", channelId: "2", channelName: "XQC" },
    ),
    true,
  );
  assert.equal(
    streamsMatchChannelIdentity(
      { platform: "kick", channelId: "1", channelName: "xqc" },
      { platform: "twitch", channelId: "1", channelName: "xqc" },
    ),
    false,
  );
});
