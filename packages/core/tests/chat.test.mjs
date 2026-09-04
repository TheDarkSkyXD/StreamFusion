import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_DISABLED_REASON,
  CHAT_RECONNECTING_REASON,
  chatEventSchema,
  chatMessageSchema,
  resolveAccountAgeRequirement,
  resolveChatSendEligibility,
  toSerializedTimestamp,
} from "@streamfusion/core/chat";
import { chatFixtures } from "@streamfusion/core/testing";

const message = chatFixtures.message;

test("normalized chat messages survive JSON serialization", () => {
  const roundTrip = JSON.parse(JSON.stringify(message));

  assert.equal(chatMessageSchema.is(roundTrip), true);
  assert.deepEqual(roundTrip, message);
});

test("chat message schemas reject Date objects and non-canonical timestamps", () => {
  assert.equal(
    chatMessageSchema.is({ ...message, timestamp: new Date() }),
    false,
  );
  assert.equal(
    chatMessageSchema.is({ ...message, timestamp: "2026-08-31T12:00:00Z" }),
    false,
  );
  assert.equal(
    chatMessageSchema.is({ ...message, deletedAt: "2026-08-31" }),
    false,
  );
  assert.equal(
    chatMessageSchema.is({
      ...message,
      banInfo: {
        bannedUsername: "viewer",
        deletedMessageDetails: [
          {
            id: "message-0",
            author: message.deletedByUser,
            content: [{ type: "text", content: "removed" }],
            rawContent: "removed",
            deletedAt: new Date(),
          },
        ],
      },
    }),
    false,
  );
});

test("chat message schemas reject raw provider and IPC fields", () => {
  assert.equal(chatMessageSchema.is({ ...message, chatroomId: 123 }), false);
  assert.equal(
    chatMessageSchema.is({ ...message, ipcChannel: "chat:message" }),
    false,
  );
  assert.equal(
    chatMessageSchema.is({
      ...message,
      content: [{ type: "emote", id: "1", name: "x", url: "x", raw: {} }],
    }),
    false,
  );
});

test("normalized chat events survive JSON serialization without provider payloads", () => {
  const events = [
    { kind: "message", message },
    {
      kind: "connection-state-changed",
      status: {
        platform: "kick",
        state: "connected",
        channels: ["streamer"],
        isAuthenticated: true,
        connectedAt: toSerializedTimestamp("2026-08-31T12:00:00.000Z"),
      },
    },
    {
      kind: "message-deleted",
      deletion: {
        platform: "kick",
        channel: "streamer",
        messageId: "message-1",
        deletedByUsername: "moderator",
        timestamp: toSerializedTimestamp("2026-08-31T12:01:00.000Z"),
      },
    },
    {
      kind: "user-notice",
      notice: {
        id: "notice-1",
        platform: "twitch",
        channel: "streamer",
        type: "resub",
        userId: "viewer-1",
        username: "viewer",
        displayName: "Viewer",
        systemMessage: "Viewer subscribed for 3 months",
        timestamp: toSerializedTimestamp("2026-08-31T12:01:30.000Z"),
        months: 3,
      },
    },
    {
      kind: "chat-cleared",
      clear: {
        platform: "kick",
        channel: "streamer",
        targetUserId: "viewer-1",
        duration: 60,
        isClearAll: false,
        timestamp: toSerializedTimestamp("2026-08-31T12:01:45.000Z"),
      },
    },
    {
      kind: "viewer-send-restricted",
      restriction: {
        platform: "twitch",
        channel: "streamer",
        channelId: "channel-1",
        restriction: "verification",
        requirement: "phone",
      },
    },
    {
      kind: "room-state-changed",
      room: {
        platform: "kick",
        channel: "streamer",
        channelId: "channel-1",
        patch: { slowMode: 10, followersOnly: null },
        reason: "ws",
      },
    },
    {
      kind: "moderator-state-changed",
      moderator: {
        platform: "twitch",
        channel: "streamer",
        channelId: "channel-1",
        isModerator: true,
        reason: "ws",
      },
    },
  ];

  for (const event of events) {
    const roundTrip = JSON.parse(JSON.stringify(event));
    assert.equal(chatEventSchema.is(roundTrip), true);
    assert.deepEqual(roundTrip, event);
  }

  assert.equal(
    chatEventSchema.is({
      kind: "connection-state-changed",
      status: {
        platform: "kick",
        state: "connected",
        channels: ["streamer"],
        isAuthenticated: true,
        connectedAt: new Date(),
      },
    }),
    false,
  );
  assert.equal(
    chatEventSchema.is({
      kind: "message",
      message: { ...message, pusherPayload: {} },
    }),
    false,
  );
});

test("chat send eligibility preserves authentication, lifecycle, and room policy order", () => {
  assert.deepEqual(
    resolveChatSendEligibility({
      isAuthenticated: false,
      canSend: false,
      disabled: true,
      roomRestrictionReason: "Followers only",
    }),
    { state: "ineligible", reason: "Sign in to chat" },
  );
  assert.deepEqual(
    resolveChatSendEligibility({
      isAuthenticated: true,
      canSend: false,
      disabled: true,
      roomRestrictionReason: "Followers only",
    }),
    { state: "ineligible", reason: CHAT_DISABLED_REASON },
  );
  assert.deepEqual(
    resolveChatSendEligibility({
      isAuthenticated: true,
      canSend: false,
      disabled: false,
      roomRestrictionReason: "Followers only",
    }),
    { state: "ineligible", reason: CHAT_RECONNECTING_REASON },
  );
  assert.deepEqual(
    resolveChatSendEligibility({
      isAuthenticated: true,
      canSend: true,
      disabled: false,
      roomRestrictionReason: "Followers only",
    }),
    { state: "ineligible", reason: "Followers only" },
  );
  assert.deepEqual(
    resolveChatSendEligibility({
      isAuthenticated: true,
      canSend: true,
      disabled: false,
    }),
    { state: "eligible" },
  );
});

test("account-age eligibility is exact and fail-closed only when evidence proves a restriction", () => {
  const nowMs = Date.parse("2026-08-31T02:00:00.000Z");
  assert.equal(
    resolveAccountAgeRequirement({
      accountCreatedAt: "2026-08-31T01:00:01.000Z",
      requiredMinutes: 60,
      nowMs,
    }),
    "restricted",
  );
  assert.equal(
    resolveAccountAgeRequirement({
      accountCreatedAt: "2026-08-31T01:00:00.000Z",
      requiredMinutes: 60,
      nowMs,
    }),
    "satisfied",
  );
  assert.equal(
    resolveAccountAgeRequirement({
      accountCreatedAt: undefined,
      requiredMinutes: 60,
      nowMs,
    }),
    "unknown",
  );
});
