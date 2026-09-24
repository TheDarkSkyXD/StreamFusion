import { describe, expect, it } from "vitest";

import { toSerializedTimestamp } from "@streamfusion/core/activity";

import {
  activityItemFromPayload,
  notificationOpenLocation,
  proofLivePayload,
} from "../domain/notification-entry";

const endedPayload = {
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

describe("notification entry routing", () => {
  it("routes ended streams to the channel page and live streams to Watch", () => {
    expect(notificationOpenLocation(endedPayload)).toEqual({
      kind: "channel",
      platform: "twitch",
      id: "chan-1",
      username: "proofstreamer",
    });
    expect(
      notificationOpenLocation({
        ...endedPayload,
        destination: { ...endedPayload.destination, streamState: "live" },
      }),
    ).toEqual({
      kind: "watch",
      platform: "twitch",
      channelId: "chan-1",
      channelLogin: "proofstreamer",
    });
  });

  it("does not reconcile ended watch payloads into Activity", () => {
    expect(activityItemFromPayload(endedPayload)).toBeNull();
  });

  it("reconciles a go-live alert into Activity without playable URLs", () => {
    const payload = proofLivePayload("2026-09-15T12:00:00.000Z");
    const item = activityItemFromPayload(payload);
    expect(item).toMatchObject({
      eventId: payload.eventId,
      kind: "channel",
      event: "live-alert",
      occurredAt: toSerializedTimestamp(payload.occurredAt),
      title: payload.title,
    });
    expect(JSON.stringify(item)).not.toMatch(/https?:\/\//);
  });
});
