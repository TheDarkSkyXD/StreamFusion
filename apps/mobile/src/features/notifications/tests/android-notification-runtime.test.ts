import { beforeEach, describe, expect, it, vi } from "vitest";

import { proofLivePayload } from "../domain/notification-entry";

const { native, listeners } = vi.hoisted(() => ({
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

vi.mock("react-native", () => ({ Platform: { OS: "android", Version: 34 } }));
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
    vi.clearAllMocks();
    listeners.clear();
  });

  it("updates native posting policy", async () => {
    await createAndroidNotificationPolicy().apply({ enabled: false, sound: false });
    expect(native.configureLiveAlerts).toHaveBeenCalledWith(false, false);
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
