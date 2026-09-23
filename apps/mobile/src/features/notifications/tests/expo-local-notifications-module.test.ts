import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo", () => ({
  isRunningInExpoGo: vi.fn(() => true),
}));

describe("expo local notifications module", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("refuses package-root remote push loading while Expo Go is active", async () => {
    const { isExpoGoHost, loadExpoRemotePush } = await import(
      "../adapters/expo-local-notifications-module"
    );
    expect(isExpoGoHost()).toBe(true);
    await expect(loadExpoRemotePush()).resolves.toBeNull();
  });

  it("loads local presentation APIs without importing the package root", async () => {
    const scheduleNotificationAsync = vi.fn(async () => "id-1");
    const setNotificationChannelAsync = vi.fn(async () => null);
    const getPermissionsAsync = vi.fn(async () => ({ status: "granted" }));
    const requestPermissionsAsync = vi.fn(async () => ({ status: "granted" }));
    const getLastNotificationResponseAsync = vi.fn(async () => null);
    const addNotificationReceivedListener = vi.fn(() => ({ remove: () => undefined }));
    const addNotificationResponseReceivedListener = vi.fn(() => ({
      remove: () => undefined,
    }));
    const setNotificationHandler = vi.fn();

    vi.doMock("expo-notifications/build/setNotificationChannelAsync.js", () => ({
      setNotificationChannelAsync,
    }));
    vi.doMock(
      "expo-notifications/build/NotificationChannelManager.types.js",
      () => ({
        AndroidImportance: { DEFAULT: 5, MAX: 7 },
      }),
    );
    vi.doMock("expo-notifications/build/NotificationPermissions.js", () => ({
      getPermissionsAsync,
      requestPermissionsAsync,
    }));
    vi.doMock("expo-notifications/build/scheduleNotificationAsync.js", () => ({
      scheduleNotificationAsync,
    }));
    vi.doMock("expo-notifications/build/NotificationsEmitter.js", () => ({
      addNotificationReceivedListener,
      addNotificationResponseReceivedListener,
      getLastNotificationResponseAsync,
    }));
    vi.doMock("expo-notifications/build/NotificationsHandler.js", () => ({
      setNotificationHandler,
    }));

    const { loadExpoLocalNotifications } = await import(
      "../adapters/expo-local-notifications-module"
    );
    const local = await loadExpoLocalNotifications();
    expect(local).not.toBeNull();
    expect(local?.AndroidImportance.MAX).toBe(7);
    await local?.scheduleNotificationAsync({
      content: { title: "xQc is live", body: "Just Chatting" },
      trigger: null,
    });
    expect(scheduleNotificationAsync).toHaveBeenCalledOnce();
  });
});
