import { describe, expect, it, vi } from "vitest";

import { proofLivePayload } from "../domain/notification-entry";

const { native } = vi.hoisted(() => ({
  native: {
    configureBackgroundChecks: vi.fn(async () => JSON.stringify({
      schemaVersion: 1, scheduled: true, intervalMinutes: 15,
      channelCount: 1, lastCheckedAtMs: null, failure: null,
    })),
    getBackgroundCheckStatus: vi.fn(async () => "{}"),
    readBackgroundEvents: vi.fn(async () => "[]"),
    acknowledgeBackgroundEvents: vi.fn(async () => undefined),
  },
}));
vi.mock("../adapters/android-notifications-module", () => ({
  getNativeNotifications: () => native,
}));

import { createAndroidBackgroundLiveAlerts } from "../adapters/android-background-live-alerts";

describe("Android background checks bridge", () => {
  it("serializes the snapshot and parses the native status", async () => {
    const alerts = createAndroidBackgroundLiveAlerts();
    const snapshot = {
      schemaVersion: 1 as const, channels: [{ platform: "twitch" as const,
        channelId: "71092938", channelLogin: "xqc", displayName: "xQc" }],
      policy: { historyEnabled: true, systemAlerts: true, toastAlerts: true,
        sound: false, restartGraceMinutes: 15 as const },
      observations: [{ platform: "twitch" as const, channelId: "71092938",
        observedAtMs: 1000, kind: "live" as const, streamId: "stream-1", title: "Live" }],
    };
    expect(await alerts.configure(snapshot)).toEqual({
      schemaVersion: 1, scheduled: true, intervalMinutes: 15,
      channelCount: 1, lastCheckedAtMs: null, failure: null,
    });
    expect(JSON.parse(native.configureBackgroundChecks.mock.lastCall?.[0] ?? "{}")).toEqual(snapshot);
  });

  it("rejects malformed status and pending events", async () => {
    const alerts = createAndroidBackgroundLiveAlerts();
    await expect(alerts.status()).rejects.toThrow("Invalid background check status");
    native.getBackgroundCheckStatus.mockResolvedValueOnce(JSON.stringify({
      schemaVersion: 1, scheduled: true, intervalMinutes: 15,
      channelCount: 1, lastCheckedAtMs: null, failure: null, token: "unexpected",
    }));
    await expect(alerts.status()).rejects.toThrow("Invalid background check status");
    native.readBackgroundEvents.mockResolvedValueOnce(JSON.stringify([{}]));
    await expect(alerts.pending()).rejects.toThrow("Invalid pending background events");
    const payload = proofLivePayload("2026-09-15T12:00:00.000Z");
    native.readBackgroundEvents.mockResolvedValueOnce(JSON.stringify([payload]));
    expect(await alerts.pending()).toEqual([payload]);
    await alerts.acknowledge([payload.eventId]);
    expect(native.acknowledgeBackgroundEvents).toHaveBeenCalledWith(JSON.stringify([payload.eventId]));
  });
});
