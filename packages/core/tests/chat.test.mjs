import assert from "node:assert/strict";
import test from "node:test";

import { chatMessageSchema } from "@streamfusion/core/chat";
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
