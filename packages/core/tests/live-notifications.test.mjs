import assert from "node:assert/strict";
import test from "node:test";

import { safeNotificationPayloadSchema } from "../src/relay/live-notifications.ts";

const livePayload = {
  schemaVersion: 1,
  eventId: "live:twitch:chan-1:2026-09-15",
  sourceId: "local:live-check:v1",
  channel: "live",
  title: "ProofStreamer is live",
  body: "Just Chatting",
  destination: {
    kind: "watch-channel",
    platform: "twitch",
    channelId: "chan-1",
    channelLogin: "proofstreamer",
    streamState: "live",
  },
  occurredAt: "2026-09-15T12:00:00.000Z",
};

test("safe payloads accept allowlisted destinations and reject credentials or media URLs", () => {
  assert.equal(safeNotificationPayloadSchema.is(livePayload), true);
  assert.equal(
    safeNotificationPayloadSchema.is({
      ...livePayload,
      destination: { ...livePayload.destination, streamState: "ended" },
    }),
    true,
  );
  assert.equal(
    safeNotificationPayloadSchema.is({
      ...livePayload,
      url: "https://example.com/hls.m3u8",
    }),
    false,
  );
  assert.equal(
    safeNotificationPayloadSchema.is({
      ...livePayload,
      body: "Watch https://kick.com/clip",
    }),
    false,
  );
  assert.equal(
    safeNotificationPayloadSchema.is({
      ...livePayload,
      access_token: "secret",
    }),
    false,
  );
});
