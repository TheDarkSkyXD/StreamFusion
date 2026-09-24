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
const setNotificationHandler = vi.fn();
const getPermissionsAsync = vi.fn(async () => ({ status: "granted" as const }));
const requestPermissionsAsync = vi.fn(async () => ({
  status: "granted" as const,
}));

function expoModule() {
  return {
    AndroidImportance: { DEFAULT: 5, MAX: 7 },
    scheduleNotificationAsync,
    setNotificationChannelAsync,
    setNotificationHandler,
    getPermissionsAsync,
    requestPermissionsAsync,
  };
}

vi.mock("../adapters/expo-local-notifications-module", () => ({
  isExpoGoHost: vi.fn(() => true),
  loadExpoLocalNotifications: vi.fn(async () => expoModule()),
  loadExpoRemotePush: vi.fn(async () => null),
}));

const EXPO_GO_FALLBACK_CHANNEL_ID =
  "expo_notifications_fallback_notification_channel";

describe("expo notification runtime Expo Go channels", () => {
  beforeEach(async () => {
    // resetModules clears module-level foregroundHandlerInstalled without
    // wiping factory mock implementations (unlike clearAllMocks).
    vi.resetModules();
    scheduleNotificationAsync.mockReset().mockResolvedValue("notif-1");
    setNotificationChannelAsync.mockReset().mockResolvedValue(null);
    setNotificationHandler.mockReset();
    getPermissionsAsync.mockReset().mockResolvedValue({ status: "granted" });
    requestPermissionsAsync
      .mockReset()
      .mockResolvedValue({ status: "granted" });

    const mod = await import("../adapters/expo-local-notifications-module");
    vi.mocked(mod.isExpoGoHost).mockReturnValue(true);
    vi.mocked(mod.loadExpoLocalNotifications).mockImplementation(async () =>
      expoModule(),
    );
  });

  it("skips setNotificationChannelAsync in Expo Go so boot has no channel NPE", async () => {
    const { createExpoNotificationChannels } = await import(
      "../adapters/expo-notification-runtime"
    );
    await expect(
      createExpoNotificationChannels().ensure(),
    ).resolves.toBeUndefined();
    expect(setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it("soft-fails channel setup outside Expo Go when the native call rejects", async () => {
    const { isExpoGoHost } = await import(
      "../adapters/expo-local-notifications-module"
    );
    vi.mocked(isExpoGoHost).mockReturnValue(false);
    setNotificationChannelAsync.mockRejectedValueOnce(
      new Error(
        "Call to function 'ExpoNotificationChannelManager.setNotificationChannelAsync' has been rejected.\nCaused by: java.lang.NullPointerException: null cannot be cast to non-null type expo.modules.notifications.notifications.channels.NotificationsChannelsProvider",
      ),
    );

    const { createExpoNotificationChannels } = await import(
      "../adapters/expo-notification-runtime"
    );
    await expect(
      createExpoNotificationChannels().ensure(),
    ).resolves.toBeUndefined();
    expect(setNotificationChannelAsync).toHaveBeenCalled();
  });

  it("presents go-live alerts on the Expo Go fallback channel with handler installed", async () => {
    const { createExpoLocalNotificationPresenter } = await import(
      "../adapters/expo-notification-runtime"
    );
    const payload = proofLivePayload("2026-09-23T11:00:00.000Z");
    await createExpoLocalNotificationPresenter().present(payload);

    expect(setNotificationHandler).toHaveBeenCalledOnce();
    expect(scheduleNotificationAsync).toHaveBeenCalledOnce();
    const request = scheduleNotificationAsync.mock.calls[0]?.[0] as {
      content: Record<string, unknown>;
      trigger: Record<string, unknown> | null;
    };
    expect(request.content.title).toBe("xQc is live");
    expect(request.content.body).toBe("xQc went live on Twitch.");
    expect(request.content.channelId).toBe(EXPO_GO_FALLBACK_CHANNEL_ID);
    expect(request.trigger).toEqual({
      channelId: EXPO_GO_FALLBACK_CHANNEL_ID,
    });
  });

  it("skips scheduling ended watch payloads into the tray", async () => {
    const { createExpoLocalNotificationPresenter } = await import(
      "../adapters/expo-notification-runtime"
    );
    const live = proofLivePayload("2026-09-23T11:00:00.000Z");
    await createExpoLocalNotificationPresenter().present({
      ...live,
      eventId: "live:twitch:71092938:ended",
      title: "xQc ended",
      destination: {
        ...live.destination,
        streamState: "ended",
      },
    });

    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(setNotificationHandler).not.toHaveBeenCalled();
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
      trigger: null;
    };
    expect(request.content.channelId).toBe("live");
    expect(request.trigger).toBeNull();
  });
});