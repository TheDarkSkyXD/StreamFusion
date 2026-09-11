import assert from "node:assert/strict";
import test from "node:test";

import {
  createRelayFailureEnvelope,
  createRelaySuccessEnvelope,
  signedOutCategoriesBodySchema,
  signedOutSearchBodySchema,
  signedOutTopStreamsBodySchema,
} from "@streamfusion/core/relay";

const stream = {
  id: "1",
  platform: "twitch",
  channelId: "c1",
  channelName: "alice",
  channelDisplayName: "Alice",
  channelAvatar: "https://example.com/a.png",
  title: "Live",
  viewerCount: 12,
  thumbnailUrl: "https://example.com/t.png",
  isLive: true,
  startedAt: "2026-09-11T00:00:00.000Z",
  language: "en",
  tags: ["irl"],
};

const category = {
  id: "g1",
  platform: "twitch",
  name: "Just Chatting",
  boxArtUrl: "https://example.com/box.png",
};

const channel = {
  id: "c1",
  platform: "twitch",
  username: "alice",
  displayName: "Alice",
  avatarUrl: "https://example.com/a.png",
  isLive: true,
  isVerified: false,
  isPartner: false,
};

test("signed-out discovery bodies accept exact Core content pages", () => {
  assert.equal(
    signedOutTopStreamsBodySchema.is({
      platform: "kick",
      streams: [stream],
      cursor: "after:1",
    }),
    true,
  );
  assert.equal(
    signedOutCategoriesBodySchema.is({
      platform: "twitch",
      categories: [category],
    }),
    true,
  );
  assert.equal(
    signedOutSearchBodySchema.is({
      platform: "twitch",
      query: "alice",
      streams: [stream],
      channels: [channel],
      categories: [category],
    }),
    true,
  );
});

test("signed-out discovery bodies reject extra provider fields", () => {
  assert.equal(
    signedOutTopStreamsBodySchema.is({
      platform: "twitch",
      streams: [{ ...stream, helixUserId: "extra" }],
    }),
    false,
  );
  assert.equal(
    signedOutSearchBodySchema.is({
      platform: "twitch",
      query: "",
      streams: [],
      channels: [],
      categories: [],
    }),
    false,
  );
});

test("relay success envelopes require a request id and JSON body", () => {
  const envelope = createRelaySuccessEnvelope({
    requestId: "req-1",
    body: { platform: "twitch", streams: [] },
  });
  assert.deepEqual(envelope, {
    protocolVersion: 1,
    kind: "response",
    requestId: "req-1",
    outcome: {
      kind: "success",
      body: { platform: "twitch", streams: [] },
    },
  });
  assert.throws(
    () => createRelaySuccessEnvelope({ requestId: "", body: {} }),
    /Invalid relay success envelope/,
  );
  assert.equal(
    createRelayFailureEnvelope({
      requestId: "req-1",
      error: { code: "unavailable", retry: { kind: "after", seconds: 30 } },
    }).outcome.kind,
    "failure",
  );
});
