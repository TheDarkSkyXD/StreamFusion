import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  getLiveNotificationPreferences,
  isFollowEligibleForLiveNotification,
  liveNotificationChannelKey,
  resolveLiveNotificationDecision,
} from "@streamfusion/core/follows";

const twitchChannel = {
  platform: "twitch",
  id: "chan-1",
  username: "ProofStreamer",
};

test("live-notification preferences preserve the Desktop defaults", () => {
  const preferences = getLiveNotificationPreferences(null);

  assert.deepEqual(preferences, DEFAULT_LIVE_NOTIFICATION_PREFERENCES);
  assert.equal(preferences.enabled, true);
  assert.equal(preferences.liveAlerts, true);
  assert.equal(preferences.twitch, true);
  assert.equal(preferences.kick, true);
  assert.equal(preferences.guestFollows, true);
  assert.equal(preferences.toastAlerts, true);
  assert.equal(preferences.sound, true);
  assert.equal(preferences.favoriteChannelsOnly, false);
  assert.equal(preferences.restartGracePeriodMinutes, 0);
});

test("signed-out Guest Follows remain eligible without a platform account", () => {
  assert.equal(
    isFollowEligibleForLiveNotification({
      preferences: null,
      channel: twitchChannel,
      followSource: "guest",
    }),
    true,
  );
});

test("follow-alert policy gates global, platform, Guest Follow, and per-follow preferences", () => {
  assert.equal(
    isFollowEligibleForLiveNotification({
      preferences: { liveAlerts: false },
      channel: twitchChannel,
      followSource: "guest",
    }),
    false,
  );
  assert.equal(
    isFollowEligibleForLiveNotification({
      preferences: { twitch: false },
      channel: twitchChannel,
    }),
    false,
  );
  assert.equal(
    isFollowEligibleForLiveNotification({
      preferences: { guestFollows: false },
      channel: twitchChannel,
      followSource: "guest",
    }),
    false,
  );
  assert.equal(
    isFollowEligibleForLiveNotification({
      preferences: {
        favoriteChannelsOnly: true,
        perChannelNotifications: {
          [liveNotificationChannelKey(twitchChannel)]: false,
        },
      },
      channel: twitchChannel,
    }),
    false,
  );
});

test("notification decisions separate product policy from native presentation", () => {
  const base = {
    preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
    silentSync: false,
    wasLive: false,
    eligible: true,
    systemNotificationsSupported: true,
    nowMs: 1_000,
  };

  assert.deepEqual(resolveLiveNotificationDecision(base), {
    kind: "deliver",
    inApp: true,
    systemNotification: { silent: false },
  });
  assert.deepEqual(
    resolveLiveNotificationDecision({
      ...base,
      preferences: { ...base.preferences, enabled: false },
    }),
    { kind: "deliver", inApp: true, systemNotification: null },
  );
  assert.deepEqual(
    resolveLiveNotificationDecision({
      ...base,
      systemNotificationsSupported: false,
    }),
    { kind: "deliver", inApp: true, systemNotification: null },
  );
  assert.deepEqual(
    resolveLiveNotificationDecision({ ...base, silentSync: true }),
    { kind: "ignore", reason: "silent-sync" },
  );
  assert.deepEqual(
    resolveLiveNotificationDecision({ ...base, wasLive: true }),
    { kind: "ignore", reason: "already-live" },
  );
  assert.deepEqual(
    resolveLiveNotificationDecision({ ...base, eligible: false }),
    { kind: "ignore", reason: "ineligible-follow" },
  );
});

test("notification decisions suppress restarts only inside the configured grace period", () => {
  const preferences = {
    ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
    restartGracePeriodMinutes: 5,
  };

  assert.deepEqual(
    resolveLiveNotificationDecision({
      preferences,
      silentSync: false,
      wasLive: false,
      eligible: true,
      systemNotificationsSupported: true,
      nowMs: 301_000,
      lastNotifiedAtMs: 1_000,
    }),
    { kind: "deliver", inApp: true, systemNotification: { silent: false } },
  );
  assert.deepEqual(
    resolveLiveNotificationDecision({
      preferences,
      silentSync: false,
      wasLive: false,
      eligible: true,
      systemNotificationsSupported: true,
      nowMs: 300_999,
      lastNotifiedAtMs: 1_000,
    }),
    { kind: "ignore", reason: "restart-grace" },
  );
});
