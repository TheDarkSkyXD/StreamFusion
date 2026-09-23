import { beforeEach, describe, expect, it, vi } from "vitest";

import { proofLivePayload } from "../domain/notification-entry";

vi.mock("expo", () => ({
  isRunningInExpoGo: vi.fn(() => true),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android", Version: 34 },
}));

const scheduleNotificationAsync = vi.fn(async () => "notif-1");
const setNotificationChannelAsync = vi.fn(async () => null);

vi.mock("../adapters/expo-local-notifications-module", () => ({
  isExpoGoHost: vi.fn(() => true),
  loadExpoLocalNotifications: vi.fn(async () => ({
    AndroidImportance: { DEFAULT: 5, MAX: 7 },
    scheduleNotificationAsync,
    setNotificationChannelAsync,
  })),
  loadExpoRemotePush: vi.fn(async () => null),
}));

describe("expo notification runtime Expo Go channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleNotificationAsync.mockResolvedValue("notif-1");
    setNotificationChannelAsync.mockResolvedValue(null);
  });

  it("skips setNotificationChannelAsync in Expo Go so boot has no channel NPE", async () => {
    const { isExpoGoHost } = await import(
      "../adapters/expo-local-notifications-module"
    );
    vi.mocked(isExpoGoHost).mockReturnValue(true);

    const { createExpoNotificationChannels } = await import(
      "../adapters/expo-notification-runtime"
    );
    await expect(createExpoNotificationChannels().ensure()).resolves.toBeUndefined();
    expect(setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it("soft-fails channel setup outside Expo Go when the native call rejects", async () => {
    const { isExpoGoHost } = await import(
      "../adapters/expo-local-notifications-module"
    );
    vi.mocked(isExpoGoHost).mockReturnValue(false);
    setNotificationChannelAsync.mockRejectedValueOnce(
      new Error(
        "Call to function 'ExpoNotificationChannelManager.setNotificationChannelAsync' has been rejected.\n→ Caused by: java.lang.NullPointerException: null cannot be cast to non-null type expo.modules.notifications.notifications.channels.NotificationsChannelsProvider",
      ),
    );

    const { createExpoNotificationChannels } = await import(
      "../adapters/expo-notification-runtime"
    );
    await expect(createExpoNotificationChannels().ensure()).resolves.toBeUndefined();
    expect(setNotificationChannelAsync).toHaveBeenCalled();
  });

  it("presents guest live alerts via scheduleNotificationAsync without channelId in Expo Go", async () => {
    const { isExpoGoHost } = await import(
      "../adapters/expo-local-notifications-module"
    );
    vi.mocked(isExpoGoHost).mockReturnValue(true);

    const { createExpoLocalNotificationPresenter } = await import(
      "../adapters/expo-notification-runtime"
    );
    await createExpoLocalNotificationPresenter().present(
      proofLivePayload("2026-09-23T11:00:00.000Z"),
    );

    expect(scheduleNotificationAsync).toHaveBeenCalledOnce();
    const request = scheduleNotificationAsync.mock.calls[0]?.[0] as {
      content: Record<string, unknown>;
    };
    expect(request.content.title).toBe("ProofStreamer ended");
    expect(request.content.channelId).toBeUndefined();
  });

  it("attaches Android channelId outside Expo Go after channels can be created", async () => {
    const { isExpoGoHost } = await import(
      "../adapters/expo-local-notifications-module"
    );
    vi.mocked(isExpoGoHost).mockReturnValue(false);

    const { createExpoLocalNotificationPresenter } = await import(
      "../adapters/expo-notification-runtime"
    );
    await createExpoLocalNotificationPresenter().present(
      proofLivePayload("2026-09-23T11:00:00.000Z"),
    );

    const request = scheduleNotificationAsync.mock.calls[0]?.[0] as {
      content: Record<string, unknown>;
    };
    expect(request.content.channelId).toBe("live");
  });
});
