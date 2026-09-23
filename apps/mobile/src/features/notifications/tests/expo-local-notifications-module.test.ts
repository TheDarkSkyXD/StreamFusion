import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo", () => ({
  isRunningInExpoGo: vi.fn(() => true),
}));

describe("expo local notifications module", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../adapters/expo-local-notifications-api");
    vi.doUnmock("expo-notifications");
  });

  it("refuses package-root remote push loading while Expo Go is active", async () => {
    const { isExpoGoHost, loadExpoRemotePush } = await import(
      "../adapters/expo-local-notifications-module"
    );
    expect(isExpoGoHost()).toBe(true);
    await expect(loadExpoRemotePush()).resolves.toBeNull();
  });

  it("loads local presentation APIs via the static shim for guest go-live alerts", async () => {
    const scheduleNotificationAsync = vi.fn(async () => "id-1");
    const setNotificationChannelAsync = vi.fn(async () => null);
    const getPermissionsAsync = vi.fn(async () => ({ status: "granted" }));
    const requestPermissionsAsync = vi.fn(async () => ({ status: "granted" }));
    const getLastNotificationResponseAsync = vi.fn(async () => null);
    const addNotificationReceivedListener = vi.fn(() => ({
      remove: () => undefined,
    }));
    const addNotificationResponseReceivedListener = vi.fn(() => ({
      remove: () => undefined,
    }));
    const setNotificationHandler = vi.fn();

    vi.doMock("../adapters/expo-local-notifications-api", () => ({
      AndroidImportance: { DEFAULT: 5, MAX: 7 },
      addNotificationReceivedListener,
      addNotificationResponseReceivedListener,
      getLastNotificationResponseAsync,
      getPermissionsAsync,
      requestPermissionsAsync,
      scheduleNotificationAsync,
      setNotificationChannelAsync,
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
    await local?.requestPermissionsAsync();
    expect(requestPermissionsAsync).toHaveBeenCalledOnce();
    await local?.setNotificationChannelAsync("live", {
      name: "Live alerts",
      importance: 7,
    });
    expect(setNotificationChannelAsync).toHaveBeenCalledOnce();
  });

  it("loads remote push outside Expo Go via package root only", async () => {
    const { isRunningInExpoGo } = await import("expo");
    vi.mocked(isRunningInExpoGo).mockReturnValue(false);

    const getDevicePushTokenAsync = vi.fn(async () => ({
      data: "dK3kExampleFcmTokenValue:APA91bProofTokenWithoutSecrets0123456789",
    }));
    const addPushTokenListener = vi.fn(() => ({ remove: () => undefined }));
    vi.doMock("expo-notifications", () => ({
      getDevicePushTokenAsync,
      addPushTokenListener,
    }));

    const { loadExpoRemotePush } = await import(
      "../adapters/expo-local-notifications-module"
    );
    const remote = await loadExpoRemotePush();
    expect(remote).not.toBeNull();
    await remote?.getDevicePushTokenAsync();
    expect(getDevicePushTokenAsync).toHaveBeenCalledOnce();
  });
});
