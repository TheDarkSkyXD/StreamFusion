import { describe, expect, it } from "vitest";

import { DEFAULT_LIVE_NOTIFICATION_PREFERENCES } from "@streamfusion/core/follows";

import {
  composeNotificationSettingsView,
  mergeNotificationPreferences,
  notificationDeliveryCopy,
  notificationPermissionCopy,
} from "../domain/notification-status";

// Guards: API 30 reports platform-granted posting; denied still keeps Activity; offline copy does not claim FCM
describe("notification settings status", () => {
  it("treats API 30 as granted without a runtime prompt", () => {
    expect(notificationPermissionCopy("denied", 30)).toMatch(/without a runtime prompt/);
    const view = composeNotificationSettingsView({
      apiLevel: 30,
      network: "online",
      permission: "granted",
      preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
    });
    expect(view.denied).toBe(false);
    expect(view.permissionCopy).toMatch(/without a runtime prompt/);
    expect(view.deliveryCopy).toMatch(/Overflow past 2000 topics uses direct tokens/);
  });

  it("keeps Activity copy when Android posting is denied", () => {
    expect(notificationPermissionCopy("denied", 33)).toMatch(/Retry the permission/);
    expect(
      notificationDeliveryCopy({
        network: "online",
        permission: "denied",
        preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      }),
    ).toMatch(/Live Notification history stays active/);
  });

  it("saves locally while offline without claiming relay registration", () => {
    expect(
      notificationDeliveryCopy({
        network: "offline",
        permission: "granted",
        preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      }),
    ).toMatch(/Preferences save on this device/);
  });

  it("describes one-mode topic and direct delivery after permission is granted", () => {
    expect(notificationPermissionCopy("granted", 33)).toMatch(
      /one topic or one direct token/,
    );
  });

  it("merges a patch onto current preferences instead of defaults", () => {
    const current = mergeNotificationPreferences(DEFAULT_LIVE_NOTIFICATION_PREFERENCES, {
      favoriteChannelsOnly: true,
      kick: false,
    });
    const next = mergeNotificationPreferences(current, { sound: false });
    expect(next.favoriteChannelsOnly).toBe(true);
    expect(next.kick).toBe(false);
    expect(next.sound).toBe(false);
    expect(next.twitch).toBe(true);
  });
});
