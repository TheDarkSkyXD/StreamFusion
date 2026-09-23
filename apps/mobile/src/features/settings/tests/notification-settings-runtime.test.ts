import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  type LiveNotificationPreferences,
} from "@streamfusion/core/follows";

import type { LiveNotificationPreferenceStore } from "@mobile/features/storage/capabilities/persistence";
import type {
  NotificationNetwork,
  NotificationPermissionPort,
  NotificationPermissionSnapshot,
} from "../capabilities/notification-settings";
import { createNotificationSettingsSession } from "../composition/notification-settings-runtime";

function memoryNotifications(
  initial: LiveNotificationPreferences = DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
): LiveNotificationPreferenceStore {
  let prefs = initial;
  return {
    async read() {
      return prefs;
    },
    async write(value) {
      prefs = value as LiveNotificationPreferences;
      return prefs;
    },
  };
}

function permissionPort(
  snapshot: NotificationPermissionSnapshot,
  requests: { count: number },
): NotificationPermissionPort {
  return {
    openSystemSettings: async () => undefined,
    read: async () => snapshot,
    request: async () => {
      requests.count += 1;
      return snapshot;
    },
  };
}

function session(input?: {
  readonly network?: NotificationNetwork;
  readonly permission?: NotificationPermissionSnapshot;
  readonly store?: LiveNotificationPreferenceStore;
}) {
  const requests = { count: 0 };
  const snapshot = input?.permission ?? { apiLevel: 30, permission: "granted" };
  return {
    requests,
    settings: createNotificationSettingsSession({
      network: async () => input?.network ?? "online",
      permission: permissionPort(snapshot, requests),
      store: input?.store ?? memoryNotifications(),
    }),
  };
}

// Guards: enable requests permission; later patches keep stored flags; denied retry stays available
describe("notification settings session", () => {
  it("requests permission only when Android notifications are turned on", async () => {
    const store = memoryNotifications({
      ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      enabled: false,
    });
    const { requests, settings } = session({ store });
    await settings.load();
    await settings.apply({ sound: false });
    expect(requests.count).toBe(0);
    await settings.apply({ enabled: true });
    expect(requests.count).toBe(1);
    expect(settings.peek().preferences.sound).toBe(false);
  });

  it("writes the merged current preferences instead of a default patch", async () => {
    const store = memoryNotifications({
      ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      favoriteChannelsOnly: true,
      kick: false,
    });
    const { settings } = session({ store });
    await settings.load();
    const applied = await settings.apply({ toastAlerts: false });
    expect(applied.preferences.favoriteChannelsOnly).toBe(true);
    expect(applied.preferences.kick).toBe(false);
    expect(applied.preferences.toastAlerts).toBe(false);
    expect(await store.read()).toMatchObject({
      favoriteChannelsOnly: true,
      kick: false,
      toastAlerts: false,
    });
  });

  it("surfaces denied posting with a retry path on API 33", async () => {
    const { settings } = session({
      permission: { apiLevel: 33, permission: "denied" },
    });
    const loaded = await settings.load();
    expect(loaded.denied).toBe(true);
    expect(loaded.permissionCopy).toMatch(/Retry the permission/);
    const retried = await settings.retryPermission();
    expect(retried.denied).toBe(true);
  });


  it("requests permission when Guest Follow notifications are turned on", async () => {
    const store = memoryNotifications({
      ...DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
      guestFollows: false,
    });
    const { requests, settings } = session({ store });
    await settings.load();
    await settings.apply({ guestFollows: true });
    expect(requests.count).toBe(1);
    expect(settings.peek().preferences.guestFollows).toBe(true);
  });

  it("keeps local save copy when the device is offline", async () => {
    const { settings } = session({ network: "offline" });
    const loaded = await settings.load();
    expect(loaded.deliveryCopy).toMatch(/Preferences save on this device/);
  });
});
