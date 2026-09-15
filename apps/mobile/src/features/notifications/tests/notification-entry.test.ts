import { describe, expect, it } from "vitest";

import { toSerializedTimestamp } from "@streamfusion/core/activity";

import {
  activityItemFromPayload,
  notificationOpenLocation,
} from "../domain/notification-entry";

const livePayload = {
  schemaVersion: 1 as const,
  eventId: "live:twitch:chan-1:ended",
  sourceId: "relay:live-alert:v1",
  channel: "live" as const,
  title: "ProofStreamer ended",
  body: "Stream ended",
  destination: {
    kind: "watch-channel" as const,
    platform: "twitch" as const,
    channelId: "chan-1",
    channelLogin: "proofstreamer",
    streamState: "ended" as const,
  },
  occurredAt: "2026-09-15T12:00:00.000Z",
};

// Guards: ended live-alert notifications open the channel page, not a live player
describe("notification entry routing", () => {
  it("routes ended streams to the channel page and live streams to Watch", () => {
    expect(notificationOpenLocation(livePayload)).toEqual({
      kind: "channel",
      platform: "twitch",
      id: "chan-1",
      username: "proofstreamer",
    });
    expect(
      notificationOpenLocation({
        ...livePayload,
        destination: { ...livePayload.destination, streamState: "live" },
      }),
    ).toEqual({
      kind: "watch",
      platform: "twitch",
      channelId: "chan-1",
      channelLogin: "proofstreamer",
    });
  });

  it("reconciles a live-alert into Activity without playable URLs", () => {
    const item = activityItemFromPayload(livePayload);
    expect(item).toMatchObject({
      eventId: livePayload.eventId,
      kind: "channel",
      event: "live-alert",
      occurredAt: toSerializedTimestamp(livePayload.occurredAt),
    });
    expect(JSON.stringify(item)).not.toMatch(/https?:\/\//);
  });
});
