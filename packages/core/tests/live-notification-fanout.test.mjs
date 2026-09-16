import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_FCM_TOPIC_SUBSCRIPTIONS,
  liveNotificationPairKey,
  liveNotificationTopicName,
  planInstallationFanout,
  planLogicalEventDelivery,
} from "../src/relay/live-notification-fanout.ts";
import { MAX_LIVE_NOTIFICATION_PAIRS } from "../src/relay/live-notifications.ts";

test("installation fanout keeps overflow pairs instead of dropping them", () => {
  const pairs = Array.from(
    { length: MAX_FCM_TOPIC_SUBSCRIPTIONS + 3 },
    (_, index) => ({
      platform: "twitch",
      channelId: `chan-${index + 1}`,
    }),
  );
  const plan = planInstallationFanout(pairs);
  assert.equal(plan.topicNames.length, MAX_FCM_TOPIC_SUBSCRIPTIONS);
  assert.equal(plan.overflowPairs.length, 3);
  assert.equal(
    plan.overflowPairs[0]?.channelId,
    `chan-${MAX_FCM_TOPIC_SUBSCRIPTIONS + 1}`,
  );
  assert.ok(MAX_LIVE_NOTIFICATION_PAIRS > MAX_FCM_TOPIC_SUBSCRIPTIONS);
});

test("one live event uses topic for subscribed tokens and direct only for overflow", () => {
  const pair = { platform: "kick", channelId: "overflow-channel" };
  const topic = liveNotificationTopicName(pair);
  const sends = planLogicalEventDelivery({
    eventId: "live:kick:overflow-channel:1",
    channel: "live",
    pair,
    recipients: [
      {
        tokenFingerprint: "aaaaaaaaaaaaaaaa",
        topicNames: [topic],
        overflowKeys: [],
      },
      {
        tokenFingerprint: "bbbbbbbbbbbbbbbb",
        topicNames: [],
        overflowKeys: [liveNotificationPairKey(pair)],
      },
      {
        tokenFingerprint: "aaaaaaaaaaaaaaaa",
        topicNames: [topic],
        overflowKeys: [liveNotificationPairKey(pair)],
      },
    ],
  });
  assert.deepEqual(sends, [
    {
      mode: "topic",
      eventId: "live:kick:overflow-channel:1",
      topic,
      fingerprints: ["aaaaaaaaaaaaaaaa"],
    },
    {
      mode: "direct",
      eventId: "live:kick:overflow-channel:1",
      fingerprints: ["bbbbbbbbbbbbbbbb"],
    },
  ]);
});

test("private media and account events stay on direct tokens", () => {
  const sends = planLogicalEventDelivery({
    eventId: "media:job-1",
    channel: "media",
    pair: { platform: "twitch", channelId: "chan-1" },
    recipients: [
      {
        tokenFingerprint: "cccccccccccccccc",
        topicNames: [
          liveNotificationTopicName({
            platform: "twitch",
            channelId: "chan-1",
          }),
        ],
        overflowKeys: [],
      },
    ],
  });
  assert.deepEqual(sends, [
    {
      mode: "direct",
      eventId: "media:job-1",
      fingerprints: ["cccccccccccccccc"],
    },
  ]);
});
