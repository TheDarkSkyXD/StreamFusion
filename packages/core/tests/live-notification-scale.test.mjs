import assert from "node:assert/strict";
import test from "node:test";

import {
  countPlannedRecipients,
  liveNotificationTopicName,
  planLogicalEventDelivery,
} from "../src/relay/live-notification-fanout.ts";

const SCALE_RECIPIENTS = 100_000;
const DISPATCH_BUDGET_MS = 30_000;

function topicRecipients(topic, count) {
  return Array.from({ length: count }, (_, index) => ({
    tokenFingerprint: `fp${index}`,
    topicNames: [topic],
    overflowKeys: [],
  }));
}

test("plans 100000 topic recipients as one send within 30 seconds", () => {
  const pair = { platform: "kick", channelId: "scale-channel" };
  const topic = liveNotificationTopicName(pair);
  const start = performance.now();
  const sends = planLogicalEventDelivery({
    eventId: "live:kick:scale-channel:1",
    channel: "live",
    pair,
    recipients: topicRecipients(topic, SCALE_RECIPIENTS),
  });
  const elapsed = performance.now() - start;
  assert.ok(elapsed < DISPATCH_BUDGET_MS, `planning took ${elapsed}ms`);
  assert.equal(sends.length, 1);
  assert.equal(sends[0]?.mode, "topic");
  assert.equal(sends[0]?.topic, topic);
  assert.equal(countPlannedRecipients(sends), SCALE_RECIPIENTS);
});

test("two simultaneous live events keep separate topic sends", () => {
  const pair = { platform: "twitch", channelId: "simultaneous" };
  const topic = liveNotificationTopicName(pair);
  const recipients = topicRecipients(topic, 3);
  const first = planLogicalEventDelivery({
    eventId: "live:twitch:simultaneous:1",
    channel: "live",
    pair,
    recipients,
  });
  const second = planLogicalEventDelivery({
    eventId: "live:twitch:simultaneous:2",
    channel: "live",
    pair,
    recipients,
  });
  assert.equal(first[0]?.eventId, "live:twitch:simultaneous:1");
  assert.equal(second[0]?.eventId, "live:twitch:simultaneous:2");
  assert.equal(first[0]?.topic, second[0]?.topic);
  assert.notEqual(first[0]?.eventId, second[0]?.eventId);
});
