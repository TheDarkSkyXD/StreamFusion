import { describe, expect, it } from "vitest";

import {
  getNotificationPreferences,
  isChannelEligibleForLiveNotification,
  liveNotificationChannelKey,
} from "@/features/auth/utils/live-notification-preferences";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@shared/auth-types";

const twitchChannel = {
  platform: "twitch" as const,
  id: "chan-1",
  username: "proofstreamer",
};

const kickChannel = {
  platform: "kick" as const,
  id: "kick-1",
  username: "proofkick",
};

// Guards: Live Notification eligibility must honor global live/platform/guest toggles and favorites-only per-channel gating.
describe("live notification preferences", () => {
  it("defaults to notify-by-default with restart grace off and new per-channel follows enabled", () => {
    const preferences = getNotificationPreferences(null);

    expect(preferences).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(preferences.enabled).toBe(true);
    expect(preferences.liveAlerts).toBe(true);
    expect(preferences.twitch).toBe(true);
    expect(preferences.kick).toBe(true);
    expect(preferences.guestFollows).toBe(true);
    expect(preferences.toastAlerts).toBe(true);
    expect(preferences.sound).toBe(true);
    expect(preferences.favoriteChannelsOnly).toBe(false);
    expect(preferences.restartGracePeriodMinutes).toBe(0);
    expect(
      isChannelEligibleForLiveNotification({
        preferences,
        channel: twitchChannel,
        followSource: "guest",
      })
    ).toBe(true);
  });

  it("gates by platform and Guest Follow preferences", () => {
    expect(
      isChannelEligibleForLiveNotification({
        preferences: { twitch: false },
        channel: twitchChannel,
      })
    ).toBe(false);
    expect(
      isChannelEligibleForLiveNotification({
        preferences: { kick: false },
        channel: kickChannel,
      })
    ).toBe(false);
    expect(
      isChannelEligibleForLiveNotification({
        preferences: { guestFollows: false },
        channel: twitchChannel,
        followSource: "guest",
      })
    ).toBe(false);
  });

  it("uses per-channel notification flags when favorites-only is enabled", () => {
    expect(
      isChannelEligibleForLiveNotification({
        preferences: { favoriteChannelsOnly: true },
        channel: twitchChannel,
      })
    ).toBe(true);

    expect(
      isChannelEligibleForLiveNotification({
        preferences: {
          favoriteChannelsOnly: true,
          perChannelNotifications: {
            [liveNotificationChannelKey(twitchChannel)]: false,
          },
        },
        channel: twitchChannel,
      })
    ).toBe(false);
  });
});
