import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_LIVE_NOTIFICATION_PREFERENCES } from "../src/features/follows/domain/index.ts";
import {
  buildLiveNotificationProjection,
  fingerprintNativePushToken,
  nativePushRegistrationGrantSchema,
  nativePushRegistrationRequestSchema,
  safeNotificationPayloadSchema,
} from "../src/relay/live-notifications.ts";

const nativeToken =
  "dK3kExampleFcmTokenValue:APA91bProofTokenWithoutSecrets0123456789";

const livePayload = {
  schemaVersion: 1,
  eventId: "live:twitch:chan-1:2026-09-15",
  sourceId: "relay:live-alert:v1",
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

test("native FCM registration requests require a native token and a projection", () => {
  const request = {
    schemaVersion: 1,
    nativeToken,
    tokenType: "fcm",
    projection: {
      schemaVersion: 1,
      version: 1,
      pairs: [{ platform: "twitch", channelId: "chan-1" }],
    },
    remoteDeliveryEnabled: true,
  };
  assert.equal(nativePushRegistrationRequestSchema.is(request), true);
  assert.equal(
    nativePushRegistrationRequestSchema.is({
      ...request,
      tokenType: "expo",
    }),
    false,
  );
});

test("live-notification projection keeps eligible Guest Follows and drops disabled platforms", async () => {
  const membership = [
    {
      platform: "twitch",
      channelId: "chan-1",
      channelLogin: "proofstreamer",
      displayName: "ProofStreamer",
      followedAt: "2026-09-01T00:00:00.000Z",
    },
    {
      platform: "kick",
      channelId: "chan-2",
      channelLogin: "kickproof",
      displayName: "KickProof",
      followedAt: "2026-09-01T00:00:00.000Z",
    },
  ];
  const projection = buildLiveNotificationProjection({
    membership,
    preferences: {
      ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      kick: false,
    },
    version: 3,
  });
  assert.deepEqual(projection, {
    schemaVersion: 1,
    version: 3,
    pairs: [{ platform: "twitch", channelId: "chan-1" }],
  });
  const fingerprint = await fingerprintNativePushToken(nativeToken);
  assert.match(fingerprint, /^[a-f0-9]{16}$/);
  assert.notEqual(fingerprint, nativeToken);
  assert.equal(
    nativePushRegistrationGrantSchema.is({
      registered: true,
      tokenFingerprint: fingerprint,
      projectionVersion: 3,
      topicSubscriptions: 1,
      overflowPairs: 0,
      reconciledAt: "2026-09-15T12:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    nativePushRegistrationGrantSchema.is({
      registered: true,
      tokenFingerprint: fingerprint,
      projectionVersion: 3,
      reconciledAt: "2026-09-15T12:00:00.000Z",
    }),
    false,
  );
});
