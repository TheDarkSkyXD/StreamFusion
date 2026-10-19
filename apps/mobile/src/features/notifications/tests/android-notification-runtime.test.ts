import { beforeEach, describe, expect, it, vi } from "vitest";

import { proofLivePayload } from "../domain/notification-entry";

const { native, listeners, platform } = vi.hoisted(() => ({
  platform: { OS: "android", Version: 34 },
  native: {
    configureLiveAlerts: vi.fn(async () => undefined),
    ensureChannels: vi.fn(async () => undefined),
    getPermissionStatus: vi.fn(async () => "granted"),
    requestPermission: vi.fn(async () => "granted"),
    present: vi.fn(async () => undefined),
    getInitialResponse: vi.fn(async () => null as string | null),
  },
  listeners: new Map<string, (event: unknown) => void>(),
}));

vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("../adapters/android-notifications-module", () => ({
  getNativeNotifications: () => native,
  createNotificationEvents: () => ({
    addListener: (name: string, listener: (event: unknown) => void) => {
      listeners.set(name, listener);
      return { remove: () => listeners.delete(name) };
    },
  }),
}));

import {
  createAndroidLocalNotificationPresenter,
  createAndroidNotificationPolicy,
  createAndroidNotificationChannels,
  createAndroidNotificationReceiptSource,
} from "../adapters/android-notification-runtime";

describe("Android notification runtime", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    native.getPermissionStatus.mockResolvedValue("granted");
    native.requestPermission.mockResolvedValue("granted");
    platform.Version = 34;
    listeners.clear();
  });

  it("updates native posting policy", async () => {
    await createAndroidNotificationPolicy().apply({ enabled: false, sound: false });
    expect(native.configureLiveAlerts).toHaveBeenCalledWith(false, false);
  });

  it.each([33, 34, 35, 36, 37])("enrolls enabled system alerts before closing the app on Android API %i", async (apiLevel) => {
    platform.Version = apiLevel;
    let permission = "not-requested";
    native.getPermissionStatus.mockImplementation(async () => permission);
    native.requestPermission.mockImplementation(async () => {
      permission = "granted";
      return permission;
    });

    const policy = createAndroidNotificationPolicy();
    await policy.apply({ enabled: true, sound: false });
    await policy.apply({ enabled: true, sound: false });

    expect(await native.getPermissionStatus()).toBe("granted");
    expect(native.requestPermission).toHaveBeenCalledTimes(1);
    expect(native.configureLiveAlerts).toHaveBeenLastCalledWith(true, false);
  });

  it.each(["granted", "denied", "unavailable"])("preserves %s permission when syncing enabled system alerts", async (permission) => {
    native.getPermissionStatus.mockResolvedValue(permission);

    await createAndroidNotificationPolicy().apply({ enabled: true, sound: true });

    expect(native.requestPermission).not.toHaveBeenCalled();
    expect(native.configureLiveAlerts).toHaveBeenCalledWith(true, true);
  });

  it.each([30, 31, 32])("configures system alerts without runtime permission on Android API %i", async (apiLevel) => {
    platform.Version = apiLevel;
    native.getPermissionStatus.mockResolvedValue("not-requested");

    await createAndroidNotificationPolicy().apply({ enabled: true, sound: true });

    expect(native.requestPermission).not.toHaveBeenCalled();
    expect(native.configureLiveAlerts).toHaveBeenCalledWith(true, true);
  });

  it("does not prompt while system alerts are disabled", async () => {
    native.getPermissionStatus.mockResolvedValue("not-requested");

    await createAndroidNotificationPolicy().apply({ enabled: false, sound: true });

    expect(native.requestPermission).not.toHaveBeenCalled();
    expect(native.configureLiveAlerts).toHaveBeenCalledWith(false, true);
  });

  it("creates channels and presents a live alert with its payload", async () => {
    const payload = proofLivePayload("2026-09-23T11:00:00.000Z");
    await createAndroidNotificationChannels().ensure();
    await createAndroidLocalNotificationPresenter().present(payload);
    expect(native.ensureChannels).toHaveBeenCalledOnce();
    expect(native.present).toHaveBeenCalledWith(
      payload.title, payload.body, JSON.stringify(payload), "live", false,
    );
  });

  it("keeps ended streams out of the tray", async () => {
    const live = proofLivePayload("2026-09-23T11:00:00.000Z");
    await createAndroidLocalNotificationPresenter().present({
      ...live,
      destination: { ...live.destination, streamState: "ended" },
    });
    expect(native.present).not.toHaveBeenCalled();
  });

  it("validates native receipt data and cleans up listeners", () => {
    const seen: string[] = [];
    const source = createAndroidNotificationReceiptSource();
    const remove = source.subscribe((receipt) => seen.push(receipt.payload.eventId));
    listeners.get("notificationReceived")?.({ payloadJson: "{}" });
    const payload = proofLivePayload("2026-09-23T11:00:00.000Z");
    listeners.get("notificationOpened")?.({ payloadJson: JSON.stringify(payload) });
    expect(seen).toEqual([payload.eventId]);
    remove();
    expect(listeners.size).toBe(0);
  });

});
