import { describe, expect, it } from "vitest";

import { DEFAULT_LIVE_NOTIFICATION_PREFERENCES } from "@streamfusion/core/follows";

import {
  composeNotificationSettingsView,
  mergeNotificationPreferences,
  notificationDeliveryCopy,
  notificationLifecycleCopy,
  notificationPermissionCopy,
} from "../domain/notification-status";

describe("notification settings status", () => {
  it("treats API 30 as granted without a runtime prompt", () => {
    expect(notificationPermissionCopy("denied", 30)).toMatch(
      /without a runtime prompt/,
    );
    const view = composeNotificationSettingsView({
      apiLevel: 30,
      network: "online",
      permission: "granted",
      preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
    });
    expect(view.denied).toBe(false);
    expect(view.permissionCopy).toMatch(/without a runtime prompt/);
    expect(view.deliveryCopy).toMatch(
      /phone background checks/,
    );
  });

  it("keeps Activity copy when Android posting is denied", () => {
    expect(notificationPermissionCopy("denied", 33)).toMatch(
      /Retry the permission/,
    );
    expect(
      notificationDeliveryCopy({
        network: "online",
        permission: "denied",
        preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      }),
    ).toMatch(/Live Notification history remains available/);
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

  it("explains not-requested permission before the Android prompt", () => {
    expect(notificationPermissionCopy("not-requested", 33)).toMatch(
      /has not been requested yet/,
    );
  });

  it("describes Android posting after permission is granted", () => {
    expect(notificationPermissionCopy("granted", 33)).toMatch(
      /Android allows notification posting/,
    );
  });

  it("explains phone checks while the app is closed", () => {
    const copy = notificationLifecycleCopy();
    expect(copy).toMatch(/about every 15 minutes/);
    expect(copy).toMatch(/Force-stopping/);
    expect(
      composeNotificationSettingsView({
        apiLevel: 30,
        network: "online",
        permission: "granted",
        preferences: DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      }).lifecycleCopy,
    ).toBe(copy);
  });

  it("merges a patch onto current preferences instead of defaults", () => {
    const current = mergeNotificationPreferences(
      DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      {
        favoriteChannelsOnly: true,
        kick: false,
      },
    );
    const next = mergeNotificationPreferences(current, { sound: false });
    expect(next.favoriteChannelsOnly).toBe(true);
    expect(next.kick).toBe(false);
    expect(next.sound).toBe(false);
    expect(next.twitch).toBe(true);
  });
});
