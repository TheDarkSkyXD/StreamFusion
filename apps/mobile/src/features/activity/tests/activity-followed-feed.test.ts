import { describe, expect, it } from "vitest";
import type { GuestFollow } from "@streamfusion/core/follows";

import { activityItemFromPayload, proofLivePayload } from "@mobile/features/notifications/domain/notification-entry";
import { filterFollowedLiveAlerts } from "../domain/activity-followed-feed";

const follow: GuestFollow = {
  platform: "twitch", channelId: "71092938", channelLogin: "xqc",
  displayName: "xQc", followedAt: "2026-09-01T00:00:00.000Z",
};

describe("followed Activity feed", () => {
  it("keeps a followed live alert and excludes an unfollowed channel", () => {
    const payload = proofLivePayload("2026-09-15T12:00:00.000Z");
    const followed = activityItemFromPayload(payload);
    const other = activityItemFromPayload({
      ...payload,
      eventId: "other-session",
      destination: { kind: "watch-channel", platform: "twitch",
        channelId: "other", channelLogin: "other", streamState: "live" },
    });
    if (!followed || !other) throw new Error("Expected valid Activity items");
    expect(filterFollowedLiveAlerts([followed, other], [follow]).map((item) => item.eventId))
      .toEqual([payload.eventId]);
  });
});
